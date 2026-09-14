export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface ExactEvidenceItem {
  key: string;
  points: number;
  kind: 'exact';
  expected: JsonValue;
}

export interface EvidenceCatalogPart {
  material?: string;
  task: string;
  items: ExactEvidenceItem[];
}

export interface EvidenceCatalogGroup {
  id: string;
  dimension: 'data_extraction' | 'hallucination_resistance';
  title: string;
  stem: string;
  parts: EvidenceCatalogPart[];
}

const lines = (...xs: string[]) => xs.join('\n');
const item = (points: number, expected: JsonValue): ExactEvidenceItem => ({ key: 'result', points, kind: 'exact', expected });
const parts = (
  p1: [string, string, JsonValue], p2: [string, string, JsonValue],
  p3: [string, string, JsonValue], p4: [string, string, JsonValue],
): EvidenceCatalogPart[] => [p1, p2, p3, p4].map(([material, task, expected], i) => ({ material, task, items: [item([10, 20, 30, 40][i], expected)] }));

const extractionPolicy = lines(
  '材料编号是唯一来源标识。草稿不覆盖正式记录；明确的更正只覆盖其点名字段；同级正式记录冲突时保留候选，不得自行择一。',
  '只使用截至本问给出的材料。数组按题目指定顺序；sources按材料编号升序。unknown与conflict必须显式保留，不能补常识。',
);

const hallucinationPolicy = lines(
  '只依据题面材料。determined表示全部有效材料唯一支持；insufficient表示至少存在两个兼容解释；conflict表示有效的同级直接材料互相矛盾。',
  '每项都必须给出status、有限结论value及最小相关sources；不能因为局部未知而拒绝回答其余可确定字段。sources按编号升序。',
);

const extractionGroups: EvidenceCatalogGroup[] = [
  {
    id: 'DX3-01', dimension: 'data_extraction', title: '订单、履约与追溯退款', stem: extractionPolicy,
    parts: parts(
      [lines('O01 正式订单：订单O-42，行L1，SKU K7，数量4，未税单价125 CNY。', 'N01 客服便笺：客户大概买了5件，待核。'), '提交{order_id,line_id,sku,ordered_qty,unit_price,currency,sources}。', { order_id: 'O-42', line_id: 'L1', sku: 'K7', ordered_qty: 4, unit_price: 125, currency: 'CNY', sources: ['O01'] }],
      [lines('S02 正式发运：批次B1交付L1两件。', 'S01 草稿：批次B0计划交付三件。', 'S03 正式发运：批次B2交付L1两件。'), '提交{delivered_qty,open_qty,shipment_ids,sources}；shipment_ids按编号升序。', { delivered_qty: 4, open_qty: 0, shipment_ids: ['B1', 'B2'], sources: ['O01', 'S02', 'S03'] }],
      [lines('R01 正式退款：L1一件，金额125，归属批次B2。', 'R02 更正：R01的归属批次字段改为B1，其他字段不变。'), '提交{refund_qty,refund_amount,shipment_id,recognized_net,sources}；recognized_net=订单总额−有效退款。', { refund_qty: 1, refund_amount: 125, shipment_id: 'B1', recognized_net: 375, sources: ['O01', 'R01', 'R02'] }],
      [lines('R03 正式追溯更正：R01的数量改为2，金额改为250。', 'R04 同级正式更正：R01的数量改为1，金额改为125。两份均未声明覆盖另一份。', 'C01 财务结账规则：同级冲突字段不得计算净额。'), '提交{refund_qty:{status,candidates},refund_amount:{status,candidates},recognized_net:{status,value},sources}；候选数值升序。', { refund_qty: { status: 'conflict', candidates: [1, 2] }, refund_amount: { status: 'conflict', candidates: [125, 250] }, recognized_net: { status: 'unknown', value: null }, sources: ['C01', 'O01', 'R01', 'R03', 'R04'] }],
    ),
  },
  {
    id: 'DX3-02', dimension: 'data_extraction', title: '维修别名与整机更换谱系', stem: extractionPolicy,
    parts: parts(
      [lines('W01 正式接机：设备序列号SN-A，机身标签T-19，故障部件P-old。', 'W02 检测单：P-old类型为电源板，检测失败。'), '提交{serial,tag,failed_part,part_type,sources}。', { serial: 'SN-A', tag: 'T-19', failed_part: 'P-old', part_type: '电源板', sources: ['W01', 'W02'] }],
      [lines('W03 厂商映射：SN-A与资产号AS-7指向同一设备，有效期自日2。', 'W04 维修记录：日3安装P-new替代P-old。'), '提交{asset_id,current_part,replaced_part,effective_day,sources}。', { asset_id: 'AS-7', current_part: 'P-new', replaced_part: 'P-old', effective_day: 3, sources: ['W01', 'W03', 'W04'] }],
      [lines('W05 整机更换：日6以SN-B替代SN-A，标签T-19随资产转移；P-new留在退回旧机。', 'W06 新机部件表：SN-B的电源板为P-b。'), '提交日7的{asset_id,serial,tag,power_part,old_machine_part,sources}。', { asset_id: 'AS-7', serial: 'SN-B', tag: 'T-19', power_part: 'P-b', old_machine_part: 'P-new', sources: ['W03', 'W05', 'W06'] }],
      [lines('W07 正式拆机单：日8把P-b移交备件库SP。', 'W08 同级正式记录：日8把P-b安装到SN-C；未给出先后顺序。', 'W09 日9盘点仅确认P-b不在SN-B。'), '提交日9的{sn_b_power:{status,value},p_b_location:{status,candidates},certain_fact,sources}；候选升序。', { sn_b_power: { status: 'determined', value: null }, p_b_location: { status: 'conflict', candidates: ['SN-C', 'SP'] }, certain_fact: 'P-b不在SN-B', sources: ['W07', 'W08', 'W09'] }],
    ),
  },
  {
    id: 'DX3-03', dimension: 'data_extraction', title: '实验样本谱系、作废与混样', stem: extractionPolicy,
    parts: parts(
      [lines('L01 登记：母样M0，受试者Q8，采集日1。', 'L02 分样：M0分为A1、A2，各2mL。'), '提交{parent,subject,children,volume_each_ml,sources}；children升序。', { parent: 'M0', subject: 'Q8', children: ['A1', 'A2'], volume_each_ml: 2, sources: ['L01', 'L02'] }],
      [lines('L03 检测：A1结果7.2，方法X，运行R1。', 'L04 作废：仅作废运行R1。', 'L05 复测：A1结果7.5，方法X，运行R2。'), '提交A1的{valid_result,valid_run,invalid_runs,sources}。', { valid_result: 7.5, valid_run: 'R2', invalid_runs: ['R1'], sources: ['L03', 'L04', 'L05'] }],
      [lines('L06 混样：取A1余量1mL与A2余量1mL生成POOL-P。', 'L07 检测：POOL-P结果8.0，方法Y，运行R3。'), '提交{pool,contributors,contribution_ml,result,run,sources}；contributors升序。', { pool: 'POOL-P', contributors: ['A1', 'A2'], contribution_ml: { A1: 1, A2: 1 }, result: 8, run: 'R3', sources: ['L06', 'L07'] }],
      [lines('L08 更正：L06中第二个贡献者应为B9，不是A2；未提供B9的母样。', 'L09 同级更正：L06中第二个贡献者仍为A2；两份均未覆盖另一份。'), '提交{pool_result,second_contributor:{status,candidates},traceable_to_M0:{status,value},untraceable_paths,sources}。', { pool_result: 8, second_contributor: { status: 'conflict', candidates: ['A2', 'B9'] }, traceable_to_M0: { status: 'unknown', value: null }, untraceable_paths: ['B9'], sources: ['L01', 'L02', 'L06', 'L07', 'L08', 'L09'] }],
    ),
  },
  {
    id: 'DX3-04', dimension: 'data_extraction', title: '跨仓调拨与截止时点库存', stem: extractionPolicy,
    parts: parts(
      [lines('I01 日1盘点：SKU-X在仓A为10，在仓B为4。', 'I02 日2销售：仓A出库3。'), '提交日2末{A_on_hand,B_on_hand,total,sources}。', { A_on_hand: 7, B_on_hand: 4, total: 11, sources: ['I01', 'I02'] }],
      [lines('I03 日3调拨发出：T1由A发往B，数量5。', 'I04 日4签收：B签收T1数量4，短少1。'), '提交日4末{A_on_hand,B_on_hand,in_transit,loss_pending,sources}；发出即扣源仓，签收才加目的仓。', { A_on_hand: 2, B_on_hand: 8, in_transit: 0, loss_pending: 1, sources: ['I01', 'I02', 'I03', 'I04'] }],
      [lines('I05 日4重传：再次收到I03，event_id仍为T1。', 'I06 日5调整：确认T1短少1记运输损耗。', 'I07 日5销售：仓B出库2。'), '提交日5末{A_on_hand,B_on_hand,transport_loss,total_accounted,sources}；同event_id重传去重。', { A_on_hand: 2, B_on_hand: 6, transport_loss: 1, total_accounted: 9, sources: ['I01', 'I02', 'I03', 'I04', 'I06', 'I07'] }],
      [lines('I08 日6撤销：撤销T1的发出与签收；依赖T1的损耗调整也失效。', 'I09 日6重放规则：撤销后按有效事件重算，库存不得仅做逆向加减。', 'I10 日7调拨T2：B向A发出7，但按重算余额不足，整笔不生效。'), '提交日7末{A_on_hand,B_on_hand,transport_loss,rejected_events,total,sources}。', { A_on_hand: 7, B_on_hand: 2, transport_loss: 0, rejected_events: ['T2'], total: 9, sources: ['I01', 'I02', 'I07', 'I08', 'I09', 'I10'] }],
    ),
  },
  {
    id: 'DX3-06', dimension: 'data_extraction', title: '合同字段级修订与同级冲突', stem: extractionPolicy,
    parts: parts(
      [lines('C01 主合同正式版：合同K-9；服务费1000/月；付款期30日；管辖地甲市。'), '提交{contract_id,monthly_fee,payment_days,jurisdiction,sources}。', { contract_id: 'K-9', monthly_fee: 1000, payment_days: 30, jurisdiction: '甲市', sources: ['C01'] }],
      [lines('C02 附件A：自月3起服务费改为1200；其余条款不变。', 'C03 附件B草稿：付款期改为45日。'), '提交月4的{monthly_fee,payment_days,jurisdiction,sources}。', { monthly_fee: 1200, payment_days: 30, jurisdiction: '甲市', sources: ['C01', 'C02'] }],
      [lines('C04 正式修订1：自月5起付款期45日，明确覆盖C01对应字段。', 'C05 正式修订2：自月5起管辖地乙市，明确其余字段沿用。'), '提交月6的{monthly_fee,payment_days,jurisdiction,field_sources}。', { monthly_fee: 1200, payment_days: 45, jurisdiction: '乙市', field_sources: { monthly_fee: ['C02'], payment_days: ['C04'], jurisdiction: ['C05'] } }],
      [lines('C06 正式修订3：与C04同级同日，付款期60日，未声明覆盖C04。', 'C07 正式修订4：服务费追溯至月4为1100，只覆盖月4，不影响月5以后。'), '提交月4与月6的{month4_fee,month6_fee,month6_payment:{status,candidates},month6_jurisdiction,sources}。', { month4_fee: 1100, month6_fee: 1200, month6_payment: { status: 'conflict', candidates: [45, 60] }, month6_jurisdiction: '乙市', sources: ['C02', 'C04', 'C05', 'C06', 'C07'] }],
    ),
  },
  {
    id: 'DX3-07', dimension: 'data_extraction', title: '汇总口径、币种与重复明细', stem: extractionPolicy,
    parts: parts(
      [lines('A01 明细：项目P，收入100 USD。', 'A02 明细：项目Q，收入700 CNY。', 'A03 汇率表：本期1 USD=7 CNY。'), '提交{P_cny,Q_cny,total_cny,sources}。', { P_cny: 700, Q_cny: 700, total_cny: 1400, sources: ['A01', 'A02', 'A03'] }],
      [lines('A04 汇总行：部门合计1400 CNY，包含A01与A02。', 'A05 明细：项目R，收入200 CNY。'), '提交{detail_total_cny,reported_subtotal_cny,grand_total_cny,sources}；汇总行不得与所含明细重复相加。', { detail_total_cny: 1600, reported_subtotal_cny: 1400, grand_total_cny: 1600, sources: ['A01', 'A02', 'A03', 'A04', 'A05'] }],
      [lines('A06 更正：A02金额应为800 CNY。', 'A07 旧汇总行未随更正更新。', 'A08 规则：明细更正优先，汇总行仅作一致性检查。'), '提交{reconstructed_total_cny,subtotal_status,subtotal_delta,sources}。', { reconstructed_total_cny: 1700, subtotal_status: 'stale', subtotal_delta: 100, sources: ['A01', 'A03', 'A04', 'A05', 'A06', 'A08'] }],
      [lines('A09 明细：项目S，收入50 EUR。', 'A10 本期汇率表没有EUR。', 'A11 同级两份更正分别称A01为90 USD与95 USD，互不覆盖。'), '提交{known_cny,usd_amount:{status,candidates},unconvertible,grand_total:{status,value},sources}。', { known_cny: 1000, usd_amount: { status: 'conflict', candidates: [90, 95] }, unconvertible: [{ project: 'S', amount: 50, currency: 'EUR' }], grand_total: { status: 'unknown', value: null }, sources: ['A03', 'A05', 'A06', 'A09', 'A10', 'A11'] }],
    ),
  },
  {
    id: 'DX3-08', dimension: 'data_extraction', title: '会议决议、修正案与重议', stem: extractionPolicy,
    parts: parts(
      [lines('M01 提案P7：预算上限100万元。', 'M02 首轮投票：赞成4、反对2、弃权1；章程要求有效票过半。'), '提交{proposal,limit_wan,result,sources}。', { proposal: 'P7', limit_wan: 100, result: 'adopted', sources: ['M01', 'M02'] }],
      [lines('M03 修正案A：把上限改为80万元；投票赞成3、反对3、弃权1。', 'M04 章程：修正案须赞成票严格多于反对票。'), '提交{amendment_result,effective_limit_wan,sources}。', { amendment_result: 'rejected', effective_limit_wan: 100, sources: ['M01', 'M02', 'M03', 'M04'] }],
      [lines('M05 重议动议通过，撤销M02的通过结果并重新表决P7。', 'M06 重议表决：赞成5、反对1、弃权1。', 'M07 保留意见：委员K反对采购周期，不改变表决效力。'), '提交{final_result,effective_limit_wan,reservations,sources}。', { final_result: 'adopted', effective_limit_wan: 100, reservations: [{ member: 'K', subject: '采购周期' }], sources: ['M01', 'M05', 'M06', 'M07'] }],
      [lines('M08 同级正式纪要称M06赞成3、反对3、弃权1。', 'M09 录音核验申请尚未完成，M08与M06均有效。'), '提交{final_result:{status,candidates},effective_limit:{status,value},certain_reservations,sources}。', { final_result: { status: 'conflict', candidates: ['adopted', 'rejected'] }, effective_limit: { status: 'unknown', value: null }, certain_reservations: [{ member: 'K', subject: '采购周期' }], sources: ['M01', 'M05', 'M06', 'M07', 'M08', 'M09'] }],
    ),
  },
  {
    id: 'DX3-09', dimension: 'data_extraction', title: '阶梯计费、跨月冲正与舍入', stem: extractionPolicy,
    parts: parts(
      [lines('B01 费率：每月前100单位每单位2元，101至200每单位1.5元，超过200每单位1元；各段分别计算后总额保留两位。', 'B02 1月用量80。'), '提交{month,usage,charge,sources}。', { month: '2026-01', usage: 80, charge: 160, sources: ['B01', 'B02'] }],
      [lines('B03 2月用量160。', 'B04 账期独立，不把1月用量带入2月阶梯。'), '提交2月{tier_units,tier_charges,total,sources}。', { tier_units: [100, 60, 0], tier_charges: [200, 90, 0], total: 290, sources: ['B01', 'B03', 'B04'] }],
      [lines('B05 3月冲正：B03多计20单位，追溯回2月。', 'B06 规则：冲正后重算原账期各阶梯，不按末档单价简单退款。'), '提交更正后2月{usage,tier_units,total,credit,sources}。', { usage: 140, tier_units: [100, 40, 0], total: 260, credit: 30, sources: ['B01', 'B03', 'B05', 'B06'] }],
      [lines('B07 2月另有7单位是否计费存在两份同级计量记录：一份确认、一份否认。', 'B08 税率7.5%，规则为未税总额先保留两位，再算税并保留两位。'), '提交{usage:{status,candidates},subtotal:{status,candidates},tax:{status,candidates},total:{status,candidates},sources}；候选升序。', { usage: { status: 'conflict', candidates: [140, 147] }, subtotal: { status: 'conflict', candidates: [260, 270.5] }, tax: { status: 'conflict', candidates: [19.5, 20.29] }, total: { status: 'conflict', candidates: [279.5, 290.79] }, sources: ['B01', 'B03', 'B05', 'B06', 'B07', 'B08'] }],
    ),
  },
  {
    id: 'DX3-10', dimension: 'data_extraction', title: '批次拆并与召回传播', stem: extractionPolicy,
    parts: parts(
      [lines('T01 原批次R0数量100。', 'T02 拆分：R0生成R1数量60、R2数量40。'), '提交{root,children,quantities,sources}。', { root: 'R0', children: ['R1', 'R2'], quantities: { R1: 60, R2: 40 }, sources: ['T01', 'T02'] }],
      [lines('T03 R1中20单位转为R3，其余40仍为R1。', 'T04 R2与外部批次X的10单位合并生成R4数量50。'), '提交{leaf_batches,root_contribution,sources}；批次升序。', { leaf_batches: ['R1', 'R3', 'R4'], root_contribution: { R1: 40, R3: 20, R4: 40 }, sources: ['T01', 'T02', 'T03', 'T04'] }],
      [lines('T05 出货：R1到客户A，R3到客户B，R4拆成30到C、20到D。', 'T06 召回：仅召回R0来源物料。'), '提交{affected_customers,affected_units_by_customer,unaffected_units,sources}；客户升序。', { affected_customers: ['A', 'B', 'C', 'D'], affected_units_by_customer: { A: 40, B: 20, C: 24, D: 16 }, unaffected_units: { C: 6, D: 4 }, sources: ['T02', 'T03', 'T04', 'T05', 'T06'] }],
      [lines('T07 更正：T04中R2与外部批次X各自投入量均无法由材料确定，只确认两者合计50。', 'T08 R4内部未做可追溯序列隔离，不能确定C与D各自收到多少R0来源。'), '提交{certain_affected,customer_allocation:{status,value},affected_total:{status,value},sources}。', { certain_affected: { A: 40, B: 20 }, customer_allocation: { status: 'unknown', value: null }, affected_total: { status: 'unknown', value: null }, sources: ['T02', 'T03', 'T04', 'T05', 'T06', 'T07', 'T08'] }],
    ),
  },
  {
    id: 'DX3-11', dimension: 'data_extraction', title: '权限继承、显式拒绝与临时例外', stem: extractionPolicy,
    parts: parts(
      [lines('P01 用户U直属组G1。', 'P02 G1授予read:A与write:A。'), '提交{user,permissions,sources}；权限升序。', { user: 'U', permissions: ['read:A', 'write:A'], sources: ['P01', 'P02'] }],
      [lines('P03 U同时属于G2。', 'P04 G2授予read:B。', 'P05 U被显式拒绝write:A；显式拒绝优先于组授权。'), '提交{allowed,denied,sources}；数组升序。', { allowed: ['read:A', 'read:B'], denied: ['write:A'], sources: ['P01', 'P02', 'P03', 'P04', 'P05'] }],
      [lines('P06 临时例外：日5至日7允许U write:A，明确覆盖P05。', 'P07 日6撤回U的G2成员资格。'), '提交日6的{allowed,denied,active_exceptions,sources}。', { allowed: ['read:A', 'write:A'], denied: [], active_exceptions: ['P06'], sources: ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07'] }],
      [lines('P08 日6两份同级命令：一份立即撤回P06，另一份延长P06至日9；互不覆盖。', 'P09 日8审计规则：冲突只影响write:A，其他权限仍计算。'), '提交日8的{read_A,read_B,write_A:{status,candidates},sources}。', { read_A: 'allowed', read_B: 'not_granted', write_A: { status: 'conflict', candidates: ['allowed', 'denied'] }, sources: ['P01', 'P02', 'P05', 'P06', 'P07', 'P08', 'P09'] }],
    ),
  },
  {
    id: 'DX3-12', dimension: 'data_extraction', title: '实体合并、拆分与候选保留', stem: extractionPolicy,
    parts: parts(
      [lines('E01 档案D1：姓名林禾，出生年1990，证件尾号17。', 'E02 档案D2：姓名林禾，出生年1992，证件尾号83。'), '提交{entities}，按档案ID升序，每项含{id,name,birth_year,id_suffix,sources}。', { entities: [{ id: 'D1', name: '林禾', birth_year: 1990, id_suffix: '17', sources: ['E01'] }, { id: 'D2', name: '林禾', birth_year: 1992, id_suffix: '83', sources: ['E02'] }] }],
      [lines('E03 账户A7实名尾号17，联系电话尾号4401。', 'E04 账户A8姓名林禾，联系电话尾号9930，未提供证件。'), '提交{A7_entity,A8_entity:{status,candidates},sources}；候选ID升序。', { A7_entity: 'D1', A8_entity: { status: 'unknown', candidates: ['D1', 'D2'] }, sources: ['E01', 'E02', 'E03', 'E04'] }],
      [lines('E05 合并指令：把A8暂并入D2，原因“同名”；状态为待复核。', 'E06 规则：待复核合并不改变正式实体绑定。'), '提交{A7_entity,A8_entity:{status,candidates},ignored_records,sources}。', { A7_entity: 'D1', A8_entity: { status: 'unknown', candidates: ['D1', 'D2'] }, ignored_records: ['E05'], sources: ['E01', 'E02', 'E03', 'E04', 'E05', 'E06'] }],
      [lines('E07 正式合并：D1与档案D3属于同一人，新主档D13；D3提供地址“南街5号”。', 'E08 随后正式拆分：D13拆回D1与D3，但未说明地址归属。', 'E09 A7仍以证件尾号17可绑定D1。'), '提交{A7_entity,address:{status,candidates},A8_entity:{status,candidates},certain_fields,sources}。', { A7_entity: 'D1', address: { status: 'unknown', candidates: ['D1', 'D3'] }, A8_entity: { status: 'unknown', candidates: ['D1', 'D2', 'D3'] }, certain_fields: { D1: { birth_year: 1990, id_suffix: '17' }, D2: { birth_year: 1992, id_suffix: '83' } }, sources: ['E01', 'E02', 'E03', 'E04', 'E07', 'E08', 'E09'] }],
    ),
  },
];

const hallucinationGroups: EvidenceCatalogGroup[] = [
  {
    id: 'HX3-01', dimension: 'hallucination_resistance', title: '追溯更正的时间边界', stem: hallucinationPolicy,
    parts: parts(
      [lines('S01 日1公告：项目A负责人为周岚。'), '判断日1负责人，提交{status,value,sources}。', { status: 'determined', value: '周岚', sources: ['S01'] }],
      [lines('S02 日2公告：项目A预算为80万元；未说明截止日期。'), '分别判断负责人和截止日期，提交{owner:{status,value,sources},deadline:{status,value,sources}}。', { owner: { status: 'determined', value: '周岚', sources: ['S01'] }, deadline: { status: 'insufficient', value: null, sources: [] } }],
      [lines('S03 日5更正：S01负责人字段自日4起更正为许宁。'), '提交日3与日4负责人{day3,day4,sources}。', { day3: '周岚', day4: '许宁', sources: ['S01', 'S03'] }],
      [lines('S04 日7更正：S02预算字段追溯至日2为90万元。', 'S05 日8通知：S04仅在日8录入，不改变其追溯生效日。'), '提交{day1_budget:{status,value},day3_budget:{status,value},day3_owner,day6_owner,sources}。', { day1_budget: { status: 'insufficient', value: null }, day3_budget: { status: 'determined', value: 90 }, day3_owner: '周岚', day6_owner: '许宁', sources: ['S01', 'S02', 'S03', 'S04', 'S05'] }],
    ),
  },
  {
    id: 'HX3-02', dimension: 'hallucination_resistance', title: '独立来源、转述与局部冲突', stem: hallucinationPolicy,
    parts: parts(
      [lines('S01 原始检测台账：样品Q的pH为6.8。', 'S02 新闻稿转述S01：pH为6.8。'), '判断pH，提交{status,value,independent_sources,sources}。', { status: 'determined', value: 6.8, independent_sources: ['S01'], sources: ['S01'] }],
      [lines('S03 独立复测台账：样品Q的pH为7.1。'), '判断pH并保留冲突，提交{status,candidates,sources}。', { status: 'conflict', candidates: [6.8, 7.1], sources: ['S01', 'S03'] }],
      [lines('S04 包装记录：样品Q质量20g。', 'S05 博客同时转述S02与S03，称“多数来源支持6.8”。'), '分别判断pH与质量，提交{ph:{status,candidates,sources},mass:{status,value,sources}}。', { ph: { status: 'conflict', candidates: [6.8, 7.1], sources: ['S01', 'S03'] }, mass: { status: 'determined', value: 20, sources: ['S04'] } }],
      [lines('S06 更正：S03的样品编号字段应为R，不是Q；pH字段不变。', 'S07 S06只更正归属，不否定S03测量。'), '提交Q与R的{Q_ph,Q_mass,R_ph,R_mass}，每项含status/value或candidates/sources。', { Q_ph: { status: 'determined', value: 6.8, sources: ['S01'] }, Q_mass: { status: 'determined', value: 20, sources: ['S04'] }, R_ph: { status: 'determined', value: 7.1, sources: ['S03', 'S06'] }, R_mass: { status: 'insufficient', value: null, sources: [] } }],
    ),
  },
  {
    id: 'HX3-03', dimension: 'hallucination_resistance', title: '不完备名册与覆盖声明', stem: hallucinationPolicy,
    parts: parts(
      [lines('S01 名册A列出成员甲、乙。', 'S02 声明：名册A完整覆盖一组全部成员。'), '判断甲是否为成员及丙是否为成员，提交{甲,丙}，各含status/value/sources。', { 甲: { status: 'determined', value: true, sources: ['S01'] }, 丙: { status: 'determined', value: false, sources: ['S01', 'S02'] } }],
      [lines('S03 名册B列出成员丁、戊；没有完整性声明。'), '判断丁与己是否属于B组，提交{丁,己}。', { 丁: { status: 'determined', value: true, sources: ['S03'] }, 己: { status: 'insufficient', value: null, sources: [] } }],
      [lines('S04 联合名册只声明“所有A组成员均列入联合名册”，列出甲、乙、丁。'), '判断丁是否属于A组、戊是否在联合名册覆盖范围，提交{丁属于A,戊应列入联合名册}。', { 丁属于A: { status: 'insufficient', value: null, sources: ['S04'] }, 戊应列入联合名册: { status: 'insufficient', value: null, sources: ['S03', 'S04'] } }],
      [lines('S05 更正：S02只保证A名册完整到日3。', 'S06 日4加入成员丙；日5查询。', 'S07 B组章程称“未列者不代表非成员”。'), '提交日5的{A_甲,A_丙,A_庚,B_丁,B_己}。', { A_甲: { status: 'determined', value: true, sources: ['S01'] }, A_丙: { status: 'determined', value: true, sources: ['S06'] }, A_庚: { status: 'insufficient', value: null, sources: ['S05'] }, B_丁: { status: 'determined', value: true, sources: ['S03'] }, B_己: { status: 'insufficient', value: null, sources: ['S07'] } }],
    ),
  },
  {
    id: 'HX3-04', dimension: 'hallucination_resistance', title: '条件规则与多层例外', stem: hallucinationPolicy,
    parts: parts(
      [lines('S01 规则：持证且完成培训者可进入区A。', 'S02 事实：甲持证并完成培训。'), '判断甲可否进入A，提交{status,value,sources}。', { status: 'determined', value: true, sources: ['S01', 'S02'] }],
      [lines('S03 事实：乙持证；材料未说明培训。'), '判断乙可否进入A，提交{status,value,sources}。', { status: 'insufficient', value: null, sources: ['S01', 'S03'] }],
      [lines('S04 例外：设备停机时，即使满足S01也不得进入。', 'S05 事实：当前设备停机。'), '分别判断甲和乙，提交{甲,乙}。', { 甲: { status: 'determined', value: false, sources: ['S04', 'S05'] }, 乙: { status: 'determined', value: false, sources: ['S04', 'S05'] } }],
      [lines('S06 更高优先级例外：停机期间，应急负责人可进入，但必须有当日书面指派。', 'S07 甲是长期应急负责人，未给出当日是否另有书面指派。', 'S08 丙有当日书面指派，但未说明是否为应急负责人。', 'S09 乙不是应急负责人。'), '提交{甲,乙,丙}，不得把角色或文件条件自行补全。', { 甲: { status: 'insufficient', value: null, sources: ['S06', 'S07'] }, 乙: { status: 'determined', value: false, sources: ['S04', 'S05', 'S06', 'S09'] }, 丙: { status: 'insufficient', value: null, sources: ['S06', 'S08'] } }],
    ),
  },
  {
    id: 'HX3-05', dimension: 'hallucination_resistance', title: '统计口径、分母与重复样本', stem: hallucinationPolicy,
    parts: parts(
      [lines('S01 研究报告：纳入100人，其中60人改善。'), '判断总体改善率，提交{status,value,sources}。', { status: 'determined', value: 0.6, sources: ['S01'] }],
      [lines('S02 报告未给出男性人数或男性改善人数。'), '判断男性改善率，提交{status,value,sources}。', { status: 'insufficient', value: null, sources: ['S02'] }],
      [lines('S03 附表列出地区X 40条记录、地区Y 70条记录；附表是独立记录视图，不保证覆盖S01全部人员。', 'S04 其中10人同时在X与Y记录中，S01的100人已去重。'), '判断能否从附表推出X与Y谁改善率更高，并提交{status,value,sources}。', { status: 'insufficient', value: null, sources: ['S03', 'S04'] }],
      [lines('S05 X记录中改善25条，Y记录中改善42条。', 'S06 重复10人的改善状态未披露；同一人的两条记录状态相同。'), '提交{overall_rate,X_record_rate,Y_record_rate,X_unique_vs_Y_unique:{status,value},sources}。', { overall_rate: { status: 'determined', value: 0.6, sources: ['S01'] }, X_record_rate: { status: 'determined', value: 0.625, sources: ['S03', 'S05'] }, Y_record_rate: { status: 'determined', value: 0.6, sources: ['S03', 'S05'] }, X_unique_vs_Y_unique: { status: 'insufficient', value: null, sources: ['S04', 'S05', 'S06'] }, sources: ['S01', 'S03', 'S04', 'S05', 'S06'] }],
    ),
  },
  {
    id: 'HX3-06', dimension: 'hallucination_resistance', title: '观察、相关与因果见证', stem: hallucinationPolicy,
    parts: parts(
      [lines('S01 观察：服用方案A的80人中56人改善。'), '判断观察到的改善比例，提交{status,value,sources}。', { status: 'determined', value: 0.7, sources: ['S01'] }],
      [lines('S02 未服用A的60人中30人改善。'), '判断两组观察比例差，提交{status,value,sources}。', { status: 'determined', value: 0.2, sources: ['S01', 'S02'] }],
      [lines('S03 分配由医生按病情决定；未记录病情严重度。'), '判断“A导致改善率提高20个百分点”，提交{status,value,sources}。', { status: 'insufficient', value: null, sources: ['S01', 'S02', 'S03'] }],
      [lines('S04 兼容模型M1：A对每人无效，组间差异全由病情构成。', 'S05 兼容模型M2：病情构成相同，A使部分人改善。', 'S06 两模型都精确产生S01与S02的计数。'), '提交{observed_association,causal_effect:{status,value},witness_models,sources}。', { observed_association: 0.2, causal_effect: { status: 'insufficient', value: null }, witness_models: ['M1', 'M2'], sources: ['S01', 'S02', 'S03', 'S04', 'S05', 'S06'] }],
    ),
  },
  {
    id: 'HX3-07', dimension: 'hallucination_resistance', title: '计划、承诺与已发生事实', stem: hallucinationPolicy,
    parts: parts(
      [lines('S01 日1记录：团队已完成原型。'), '判断原型是否完成，提交{status,value,sources}。', { status: 'determined', value: true, sources: ['S01'] }],
      [lines('S02 日2计划：若融资到账，将在日10发布。', 'S03 未说明融资是否到账。'), '判断日10是否会发布，提交{status,value,sources}。', { status: 'insufficient', value: null, sources: ['S02', 'S03'] }],
      [lines('S04 日5记录：融资到账。', 'S05 日6公告：撤回S02的发布计划。'), '判断融资到账、原型完成、日10发布，提交{funding,prototype,release}。', { funding: { status: 'determined', value: true, sources: ['S04'] }, prototype: { status: 'determined', value: true, sources: ['S01'] }, release: { status: 'insufficient', value: null, sources: ['S05'] } }],
      [lines('S06 合同承诺：若监管批准且S02未撤回，则必须日10发布。', 'S07 监管已批准。', 'S08 没有新的发布决定。'), '提交{contract_condition_met,obligation_exists,actual_release:{status,value},facts_still_true,sources}。', { contract_condition_met: false, obligation_exists: false, actual_release: { status: 'insufficient', value: null }, facts_still_true: ['原型已完成', '融资已到账', '监管已批准'], sources: ['S01', 'S04', 'S05', 'S06', 'S07', 'S08'] }],
    ),
  },
  {
    id: 'HX3-08', dimension: 'hallucination_resistance', title: '同名实体与局部可答字段', stem: hallucinationPolicy,
    parts: parts(
      [lines('S01 档案D1：陈沐，部门甲，工号17。', 'S02 档案D2：陈沐，部门乙，工号29。'), '判断“陈沐的部门”，提交{status,candidates,sources}。', { status: 'insufficient', candidates: ['甲', '乙'], sources: ['S01', 'S02'] }],
      [lines('S03 邮件由工号17发送，内容确认会议在周三。'), '提交{sender_department,meeting_day,sources}。', { sender_department: '甲', meeting_day: '周三', sources: ['S01', 'S03'] }],
      [lines('S04 别名表：账号muchen只关联姓名陈沐，未关联工号。', 'S05 账号muchen提交报告R。'), '判断报告R作者的部门及报告是否存在，提交{department,report_exists}。', { department: { status: 'insufficient', candidates: ['甲', '乙'], sources: ['S01', 'S02', 'S04', 'S05'] }, report_exists: { status: 'determined', value: true, sources: ['S05'] } }],
      [lines('S06 报告R正文写明作者办公地北楼；两份档案均未记录办公地。', 'S07 新映射仅确认muchen的工号不是29。'), '提交{author_employee_id,department,office,R_meeting_day:{status,value},sources}。', { author_employee_id: '17', department: '甲', office: '北楼', R_meeting_day: { status: 'insufficient', value: null }, sources: ['S01', 'S02', 'S04', 'S05', 'S06', 'S07'] }],
    ),
  },
  {
    id: 'HX3-09', dimension: 'hallucination_resistance', title: '引用断链与摘要夸大', stem: hallucinationPolicy,
    parts: parts(
      [lines('S01 原始表：处理组均值12，对照组均值10。'), '判断均值差，提交{status,value,sources}。', { status: 'determined', value: 2, sources: ['S01'] }],
      [lines('S02 摘要称“处理使结果提高20%”。', 'S03 原文未给因果识别设计。'), '判断相对均值差与因果结论，提交{relative_difference,causal_claim}。', { relative_difference: { status: 'determined', value: 0.2, sources: ['S01'] }, causal_claim: { status: 'insufficient', value: null, sources: ['S02', 'S03'] } }],
      [lines('S04 二手文章称“原论文证明所有人都提高”，但被引正文未提供。'), '判断能否支持“所有人都提高”，提交{status,value,sources}。', { status: 'insufficient', value: null, sources: ['S04'] }],
      [lines('S05 原始表另给范围：处理组8至16，对照组9至11。', 'S06 样本是否配对未披露。'), '提交{mean_claim,all_individuals_improved:{status,value},compatible_counterexample,sources}。', { mean_claim: { status: 'determined', value: '处理组均值比对照组高20%', sources: ['S01'] }, all_individuals_improved: { status: 'insufficient', value: null, sources: ['S04', 'S05', 'S06'] }, compatible_counterexample: '处理组至少可含取值8者，对照组可含取值11者', sources: ['S01', 'S04', 'S05', 'S06'] }],
    ),
  },
  {
    id: 'HX3-10', dimension: 'hallucination_resistance', title: '时间有效性、续期与追溯生效', stem: hallucinationPolicy,
    parts: parts(
      [lines('S01 许可证L有效期为日1至日5（含）。'), '判断日4是否有效，提交{status,value,sources}。', { status: 'determined', value: true, sources: ['S01'] }],
      [lines('S02 材料没有日6以后的续期记录。'), '判断日7是否有效，提交{status,value,sources}。', { status: 'determined', value: false, sources: ['S01', 'S02'] }],
      [lines('S03 日9签发续期，写明追溯自日6生效至日12。'), '提交日7与日13状态{day7,day13,sources}。', { day7: { status: 'determined', value: true, sources: ['S03'] }, day13: { status: 'determined', value: false, sources: ['S03'] }, sources: ['S03'] }],
      [lines('S04 日10通知：若日11前补交费用，则S03保持有效。', 'S05 材料未说明是否缴费。', 'S06 日8发生的检查只能使用当时已生效的规则，但日12复核使用追溯效力。'), '提交{day8_realtime_view,day8_retro_review,day10_future_validity,day13,sources}。', { day8_realtime_view: { status: 'determined', value: false, sources: ['S01'] }, day8_retro_review: { status: 'insufficient', value: null, sources: ['S03', 'S04', 'S05', 'S06'] }, day10_future_validity: { status: 'insufficient', value: null, sources: ['S04', 'S05'] }, day13: { status: 'determined', value: false, sources: ['S03'] }, sources: ['S01', 'S03', 'S04', 'S05', 'S06'] }],
    ),
  },
  {
    id: 'HX3-12', dimension: 'hallucination_resistance', title: '局部矛盾与最小冲突集合', stem: hallucinationPolicy,
    parts: parts(
      [lines('S01 台账：箱A颜色红。', 'S02 台账：箱B重量5kg。'), '提交{A_color,B_weight}，各含status/value/sources。', { A_color: { status: 'determined', value: '红', sources: ['S01'] }, B_weight: { status: 'determined', value: 5, sources: ['S02'] } }],
      [lines('S03 同级台账：箱A颜色蓝。'), '提交{A_color,B_weight}，局部冲突不得污染B。', { A_color: { status: 'conflict', candidates: ['红', '蓝'], sources: ['S01', 'S03'] }, B_weight: { status: 'determined', value: 5, sources: ['S02'] } }],
      [lines('S04 规则：红箱必须贴R标签。', 'S05 检查：箱A没有R标签。'), '提交{A_color,A_has_R,minimal_conflicts}；minimal_conflicts为按编号升序的最小冲突材料集合数组。', { A_color: { status: 'conflict', candidates: ['红', '蓝'], sources: ['S01', 'S03'] }, A_has_R: { status: 'conflict', candidates: [false, true], sources: ['S01', 'S04', 'S05'] }, minimal_conflicts: [['S01', 'S03'], ['S01', 'S04', 'S05']] }],
      [lines('S06 更高优先级更正：S01颜色字段作废；S03仍有效。', 'S07 新记录：箱C与A颜色相同。', 'S08 箱C重量未记录。'), '提交{A_color,A_has_R,B_weight,C_color,C_weight,minimal_conflicts,sources}。', { A_color: { status: 'determined', value: '蓝', sources: ['S03', 'S06'] }, A_has_R: { status: 'determined', value: false, sources: ['S05', 'S06'] }, B_weight: { status: 'determined', value: 5, sources: ['S02'] }, C_color: { status: 'determined', value: '蓝', sources: ['S03', 'S06', 'S07'] }, C_weight: { status: 'insufficient', value: null, sources: ['S08'] }, minimal_conflicts: [], sources: ['S02', 'S03', 'S05', 'S06', 'S07', 'S08'] }],
    ),
  },
];

export const evidenceCatalogGroups: EvidenceCatalogGroup[] = [...extractionGroups, ...hallucinationGroups];
