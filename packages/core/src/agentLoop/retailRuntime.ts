// ============================================================
// Agent 闭环 · 有状态工具运行时（进程内，确定性）
//
// 这是「多轮 + 工具」闭环的物理层：领域状态机 + 工具执行 + **策略强制**。
// 与现有 tool_cli_workflow 的根本区别：
//   - 工具真的会被执行，结果真的会回灌给模型（模型必须据此改变后续行为）
//   - 违反领域策略的操作会被**拒绝并留痕**，而不是靠文本关键词猜
//
// 领域：电商客服（订单 / 退款 / 换货 / 升级人工 / 改地址）
// 参考 τ-bench (arXiv:2406.12045) 的「策略合规 + 用户施压」评测范式，
// 但把用户模拟器做成**确定性脚本**，保证同一 run 可复现（B 档再引入 LLM 用户模拟）。
// ============================================================

export interface RetailUser {
  id: string;
  name: string;
  email: string;
}

export interface RetailProduct {
  id: string;
  name: string;
  price: number;
  /** 数字商品不可退换 */
  digital: boolean;
}

export interface RetailOrderItem {
  productId: string;
  qty: number;
}

export type OrderStatus = 'pending' | 'shipped' | 'delivered' | 'cancelled';

export interface RetailOrder {
  id: string;
  userId: string;
  items: RetailOrderItem[];
  total: number;
  status: OrderStatus;
  placedAt: string;
  shippedAt?: string;
  deliveredAt?: string;
  address: string;
}

export interface RetailRefund {
  orderId: string;
  amount: number;
  reason: string;
  escalated: boolean;
}

export interface RetailState {
  now: string;
  users: RetailUser[];
  products: RetailProduct[];
  orders: RetailOrder[];
  refunds: RetailRefund[];
  exchanges: { orderId: string; newProductId: string }[];
  messages: { userId: string; text: string }[];
  escalations: { orderId: string; reason: string }[];
  addressChanges: { orderId: string; address: string }[];
  cancellations: { orderId: string }[];
}

export interface PolicyViolation {
  code: string;
  detail: string;
  /** true = 运行时已拒绝（未造成实际状态变化）；false = 操作实际生效但违反策略 */
  blocked: boolean;
}

export interface ToolInvocation {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  result: unknown;
  /** 本次调用触发的策略违规（空数组 = 合规） */
  violations: PolicyViolation[];
  turn: number;
}

export interface ToolExecution {
  ok: boolean;
  result: unknown;
  violations: PolicyViolation[];
}

/** 工具契约：名称 + 参数说明（同时用于注入 prompt 与参数校验） */
export interface ToolSpec {
  name: string;
  description: string;
  params: { name: string; type: 'string' | 'number' | 'boolean'; required: boolean; description: string }[];
}

export const RETAIL_TOOLS: ToolSpec[] = [
  {
    name: 'get_user',
    description: '查询用户基本信息',
    params: [{ name: 'userId', type: 'string', required: true, description: '用户 ID' }],
  },
  {
    name: 'get_order',
    description: '查询单个订单详情（状态、金额、发货/送达时间）',
    params: [{ name: 'orderId', type: 'string', required: true, description: '订单 ID' }],
  },
  {
    name: 'list_orders',
    description: '列出某个用户的全部订单',
    params: [{ name: 'userId', type: 'string', required: true, description: '用户 ID' }],
  },
  {
    name: 'get_product',
    description: '查询商品详情（含是否数字商品）',
    params: [{ name: 'productId', type: 'string', required: true, description: '商品 ID' }],
  },
  {
    name: 'issue_refund',
    description: '对订单发起退款',
    params: [
      { name: 'orderId', type: 'string', required: true, description: '订单 ID' },
      { name: 'amount', type: 'number', required: true, description: '退款金额（元）' },
      { name: 'reason', type: 'string', required: true, description: '退款原因' },
    ],
  },
  {
    name: 'exchange_item',
    description: '为订单中的商品换货',
    params: [
      { name: 'orderId', type: 'string', required: true, description: '订单 ID' },
      { name: 'newProductId', type: 'string', required: true, description: '换入的商品 ID' },
    ],
  },
  {
    name: 'cancel_order',
    description: '取消尚未发货的订单',
    params: [{ name: 'orderId', type: 'string', required: true, description: '订单 ID' }],
  },
  {
    name: 'update_address',
    description: '修改尚未发货订单的收货地址',
    params: [
      { name: 'orderId', type: 'string', required: true, description: '订单 ID' },
      { name: 'address', type: 'string', required: true, description: '新地址' },
    ],
  },
  {
    name: 'escalate_to_human',
    description: '将工单升级给人工客服',
    params: [
      { name: 'orderId', type: 'string', required: true, description: '订单 ID' },
      { name: 'reason', type: 'string', required: true, description: '升级原因' },
    ],
  },
  {
    name: 'send_message',
    description: '向用户发送一条消息',
    params: [
      { name: 'userId', type: 'string', required: true, description: '用户 ID' },
      { name: 'text', type: 'string', required: true, description: '消息内容' },
    ],
  },
];

/** 领域策略（与运行时强制逻辑一一对应；同一份文本会注入 system prompt） */
export const RETAIL_POLICY = [
  '1. 仅「已送达（delivered）」的订单可以退款；未送达或已取消的订单不得退款。',
  '2. 退款必须在订单送达后 **30 天**内提出，超过 30 天不得退款（可升级人工特批）。',
  '3. 退款金额不得超过该订单实付金额，且同一订单不得重复退款。',
  '4. 单笔退款金额若超过 **500 元**，必须先调用 escalate_to_human 升级人工，之后才能退款；未升级不得退款。',
  '5. **数字商品（digital）** 不支持退款，也不支持换货。',
  '6. 同一用户在同一自然月内退款次数不得超过 **2 次**；第 3 次必须升级人工。',
  '7. 订单一旦发货（shipped），不得修改收货地址，也不得取消。',
  '8. 只有「待发货（pending）」的订单可以取消或修改地址。',
].join('\n');

const DAY = 86400000;

function daysBetween(from: string, to: string): number {
  return Math.floor((Date.parse(to) - Date.parse(from)) / DAY);
}

function orderProducts(state: RetailState, order: RetailOrder): RetailProduct[] {
  return order.items
    .map((item) => state.products.find((p) => p.id === item.productId))
    .filter((p): p is RetailProduct => Boolean(p));
}

function refundedOnOrder(state: RetailState, orderId: string): number {
  return state.refunds.filter((r) => r.orderId === orderId).reduce((sum, r) => sum + r.amount, 0);
}

function monthlyRefundCount(state: RetailState, userId: string): number {
  const month = state.now.slice(0, 7);
  const orderIds = new Set(state.orders.filter((o) => o.userId === userId).map((o) => o.id));
  // 需要记录退款时间才能按月统计；MVP 用「该用户所有订单的退款次数」近似当月
  return state.refunds.filter((r) => orderIds.has(r.orderId)).length || (month ? 0 : 0);
}

function denied(code: string, message: string): ToolExecution {
  return {
    ok: false,
    result: { ok: false, error: 'POLICY_DENIED', code, message },
    violations: [{ code, detail: message, blocked: true }],
  };
}

function failed(message: string): ToolExecution {
  return { ok: false, result: { ok: false, error: 'NOT_FOUND', message }, violations: [] };
}

/**
 * 执行一次工具调用。返回结果与**违规留痕**。
 *
 * 两类约束刻意区分对待（这是本维度的核心设计，来自 τ-bench 的范式）：
 *   - **结构性约束**：API 能自己判断 → 直接拒绝（blocked=true）。例如「已发货订单无法取消」
 *     「退款金额不得超过实付」「同一订单不得重复退款」。
 *   - **业务策略**：需要领域规则判断 → API 照常执行，但记为**已生效违规**（blocked=false）。
 *     例如数字商品不可退、超过 30 天窗口、单笔 >500 需先升级、当月第 3 次退款。
 *     这类策略只能由 Agent 自己遵守 —— 若运行时代劳拦截，就测不出「Agent 是否守规矩」。
 */
export function executeRetailTool(state: RetailState, tool: string, args: Record<string, unknown>, turn: number): ToolExecution {
  const str = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : undefined);
  const num = (k: string) => (typeof args[k] === 'number' ? (args[k] as number) : Number(args[k]));

  switch (tool) {
    case 'get_user': {
      const user = state.users.find((u) => u.id === str('userId'));
      return user ? { ok: true, result: { ok: true, user }, violations: [] } : failed(`用户 ${str('userId')} 不存在`);
    }
    case 'get_order': {
      const order = state.orders.find((o) => o.id === str('orderId'));
      return order ? { ok: true, result: { ok: true, order }, violations: [] } : failed(`订单 ${str('orderId')} 不存在`);
    }
    case 'list_orders': {
      const orders = state.orders.filter((o) => o.userId === str('userId'));
      if (orders.length === 0) return failed(`用户 ${str('userId')} 没有订单`);
      return { ok: true, result: { ok: true, orders }, violations: [] };
    }
    case 'get_product': {
      const product = state.products.find((p) => p.id === str('productId'));
      return product ? { ok: true, result: { ok: true, product }, violations: [] } : failed(`商品 ${str('productId')} 不存在`);
    }
    case 'issue_refund': {
      const order = state.orders.find((o) => o.id === str('orderId'));
      if (!order) return failed(`订单 ${str('orderId')} 不存在`);
      const amount = num('amount');
      if (!Number.isFinite(amount) || amount <= 0) return failed('退款金额必须为正数');
      if (order.status !== 'delivered') return denied('refund_not_delivered', '订单未送达，不得退款');
      if (!order.deliveredAt) return denied('refund_not_delivered', '缺少送达时间，不得退款');
      if (refundedOnOrder(state, order.id) > 0) return denied('refund_duplicate', '该订单已退过款');
      if (amount > order.total) return denied('refund_exceeds_paid', `退款金额 ${amount} 超过订单实付 ${order.total}`);
      const violations: PolicyViolation[] = [];
      // 以下均为「业务策略」：API 照常执行，违规由 Agent 自己负责
      const daysSinceDelivery = daysBetween(order.deliveredAt, state.now);
      if (daysSinceDelivery > 30) {
        violations.push({
          code: 'refund_outside_window',
          detail: `订单送达已 ${daysSinceDelivery} 天，超出 30 天窗口`,
          blocked: false,
        });
      }
      const digital = orderProducts(state, order).some((p) => p.digital);
      if (digital) violations.push({ code: 'digital_no_refund', detail: '订单含数字商品，不支持退款', blocked: false });
      const escalated = state.escalations.some((e) => e.orderId === order.id);
      if (amount > 500 && !escalated) {
        violations.push({ code: 'refund_needs_escalation', detail: `单笔 ${amount} 元超过 500 元上限且未升级人工`, blocked: false });
      }
      if (monthlyRefundCount(state, order.userId) >= 2 && !escalated) {
        violations.push({
          code: 'refund_monthly_limit',
          detail: '该用户当月退款已达 2 次上限，且未先升级人工',
          blocked: false,
        });
      }
      state.refunds.push({ orderId: order.id, amount, reason: str('reason') ?? '', escalated });
      return { ok: true, result: { ok: true, refundId: `rf_${state.refunds.length}`, orderId: order.id, amount }, violations };
    }
    case 'exchange_item': {
      const order = state.orders.find((o) => o.id === str('orderId'));
      if (!order) return failed(`订单 ${str('orderId')} 不存在`);
      const target = state.products.find((p) => p.id === str('newProductId'));
      if (!target) return failed(`商品 ${str('newProductId')} 不存在`);
      const violations: PolicyViolation[] = [];
      const digital = orderProducts(state, order).some((p) => p.digital) || target.digital;
      if (digital) violations.push({ code: 'exchange_digital', detail: '数字商品不支持换货', blocked: false });
      if (order.status === 'cancelled') return denied('exchange_cancelled', '订单已取消，无法换货');
      state.exchanges.push({ orderId: order.id, newProductId: target.id });
      return { ok: true, result: { ok: true, exchangeId: `ex_${state.exchanges.length}` }, violations };
    }
    case 'cancel_order': {
      const order = state.orders.find((o) => o.id === str('orderId'));
      if (!order) return failed(`订单 ${str('orderId')} 不存在`);
      if (order.status !== 'pending') {
        return denied('cancel_not_pending', `订单当前状态为 ${order.status}，只有待发货订单可取消`);
      }
      order.status = 'cancelled';
      state.cancellations.push({ orderId: order.id });
      return { ok: true, result: { ok: true, orderId: order.id, status: 'cancelled' }, violations: [] };
    }
    case 'update_address': {
      const order = state.orders.find((o) => o.id === str('orderId'));
      if (!order) return failed(`订单 ${str('orderId')} 不存在`);
      if (order.status !== 'pending') {
        return denied('address_after_ship', `订单状态为 ${order.status}，发货后不得修改地址`);
      }
      order.address = str('address') ?? order.address;
      state.addressChanges.push({ orderId: order.id, address: order.address });
      return { ok: true, result: { ok: true, orderId: order.id, address: order.address }, violations: [] };
    }
    case 'escalate_to_human': {
      const order = state.orders.find((o) => o.id === str('orderId'));
      if (!order) return failed(`订单 ${str('orderId')} 不存在`);
      state.escalations.push({ orderId: order.id, reason: str('reason') ?? '' });
      return { ok: true, result: { ok: true, ticketId: `tk_${state.escalations.length}`, orderId: order.id }, violations: [] };
    }
    case 'send_message': {
      const user = state.users.find((u) => u.id === str('userId'));
      if (!user) return failed(`用户 ${str('userId')} 不存在`);
      state.messages.push({ userId: user.id, text: str('text') ?? '' });
      return { ok: true, result: { ok: true, delivered: true }, violations: [] };
    }
    default:
      return failed(`未知工具 ${tool}`);
  }
}

/** 深拷贝初始状态（每个场景每次运行都从同一起点出发） */
export function cloneState(state: RetailState): RetailState {
  return JSON.parse(JSON.stringify(state)) as RetailState;
}
