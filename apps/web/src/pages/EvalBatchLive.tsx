import { useEffect, useRef, useState, useCallback } from 'react';
import { Card, Progress, Tag, Button, Row, Col, Spin, Alert, Typography, Statistic, Tooltip, Tabs } from 'antd';
import { useParams, useNavigate, Link } from 'react-router-dom';
import type { BatchProgressResponse, BatchRunStatus } from '@zxbench/types';

const { Text, Title } = Typography;

function formatDuration(ms: number | null): string {
  if (ms == null || ms < 0) return '—';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const STATUS_COLOR: Record<string, string> = {
  completed: 'green',
  running: 'blue',
  failed: 'red',
  paused: 'orange',
  cancelled: 'default',
  pending: 'default',
};

const STATUS_LABEL: Record<string, string> = {
  completed: '已完成',
  running: '评测中',
  failed: '失败',
  paused: '已暂停',
  cancelled: '已取消',
  pending: '排队中',
};

export default function EvalBatchLive() {
  const { groupName } = useParams<{ groupName: string }>();
  const navigate = useNavigate();
  const [batch, setBatch] = useState<BatchProgressResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [activeRunId, setActiveRunId] = useState<string>();
  const pollRef = useRef<number | null>(null);

  const fetchBatch = useCallback(async () => {
    if (!groupName) return;
    try {
      const res = await fetch(`/api/runs/batch/${encodeURIComponent(groupName)}`);
      const json = await res.json();
      if (json.success) {
        setBatch(json.data);
        setError(null);
      } else {
        setError(json.error || '加载批量任务失败');
      }
    } catch {
      setError('请求失败，请检查服务是否在线');
    } finally {
      setLoading(false);
    }
  }, [groupName]);

  // 初次加载 + 每 2 秒轮询（批量端点直接读取各模型实时缓存进度）
  useEffect(() => {
    setLoading(true);
    fetchBatch();
    pollRef.current = window.setInterval(fetchBatch, 2000);
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [fetchBatch]);

  // 每秒刷新一次，使运行中模型的耗时实时跳动
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // 首次拿到批量数据时默认展示第一个模型；后续轮询不打断用户当前选中的 Tab。
  useEffect(() => {
    if (!batch?.runs.length) return;
    if (!activeRunId || !batch.runs.some((run) => run.id === activeRunId)) {
      setActiveRunId(batch.runs[0].id);
    }
  }, [batch, activeRunId]);

  if (loading && !batch) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
        <div style={{ marginTop: 16, color: 'var(--text-helper)' }}>正在加载批量评测任务…</div>
      </div>
    );
  }

  if (error && !batch) {
    return (
      <div>
        <h2 className="swiss-page-title">多模型并行评测</h2>
        <Alert type="error" showIcon message={error} />
        <div style={{ marginTop: 16 }}>
          <Link to="/eval/create"><Button>返回创建评测</Button></Link>
        </div>
      </div>
    );
  }

  const data = batch!;
  // 组级耗时：进行中时实时计算到当前时刻
  const groupDuration = data.groupFinishedAt
    ? data.groupDurationMs
    : (data.groupStartedAt ? now - new Date(data.groupStartedAt).getTime() : null);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 className="swiss-page-title" style={{ marginBottom: 4 }}>多模型并行评测</h2>
          <Text type="secondary" style={{ fontSize: 13 }}>分组：{data.groupName}（{data.totalModels} 个模型并发执行）</Text>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={fetchBatch}>刷新</Button>
          <Link to="/eval/create"><Button type="primary">新建评测</Button></Link>
        </div>
      </div>

      {/* 组级汇总 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6} md={3}>
          <Card className="swiss-card" bodyStyle={{ padding: 16 }}>
            <Statistic title="模型总数" value={data.totalModels} />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={3}>
          <Card className="swiss-card" bodyStyle={{ padding: 16 }}>
            <Statistic title="已完成" value={data.completedCount} valueStyle={{ color: '#52c41a' }} suffix={`/ ${data.totalModels}`} />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={3}>
          <Card className="swiss-card" bodyStyle={{ padding: 16 }}>
            <Statistic title="评测中" value={data.runningCount} valueStyle={{ color: '#1677ff' }} />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={3}>
          <Card className="swiss-card" bodyStyle={{ padding: 16 }}>
            <Statistic title="失败" value={data.failedCount} valueStyle={{ color: data.failedCount > 0 ? '#ff4d4f' : undefined }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card className="swiss-card" bodyStyle={{ padding: 16 }}>
            <Statistic title="总耗时（最早开始 ~ 最晚结束）" value={formatDuration(groupDuration)} valueStyle={{ fontSize: 22 }} />
          </Card>
        </Col>
      </Row>

      {error && <Alert type="warning" showIcon message={error} style={{ marginBottom: 16 }} />}

      {/* 每个模型独立一个 Tab，轮询更新时保留当前 Tab。 */}
      <Card className="swiss-card" bodyStyle={{ paddingTop: 8 }}>
        <Tabs
          activeKey={activeRunId}
          onChange={setActiveRunId}
          tabBarGutter={12}
          items={data.runs.map((run) => ({
            key: run.id,
            label: (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span>{run.modelName || run.name}</span>
                <Tag color={STATUS_COLOR[run.status] || 'default'} style={{ marginInlineEnd: 0 }}>
                  {run.status === 'running' ? `${run.percentage}%` : (STATUS_LABEL[run.status] || run.status)}
                </Tag>
              </span>
            ),
            children: <BatchRunPanel run={run} now={now} />,
          }))}
        />
      </Card>
    </div>
  );
}

function BatchRunPanel({ run, now }: { run: BatchRunStatus; now: number }) {
  // 运行中耗时实时计算
  const liveDuration =
    run.status === 'running' || run.status === 'paused'
      ? now - new Date(run.createdAt).getTime()
      : run.durationMs;

  const avg = run.summary?.averageScore ?? null;
  const passCount = run.summary?.passCount ?? null;
  const progressPercent = run.total > 0 ? Math.round((run.completed / run.total) * 100) : (run.percentage || 0);

  const strokeColor = run.status === 'failed' ? '#ff4d4f' : run.status === 'completed' ? '#52c41a' : '#1677ff';

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <Tooltip title={run.id}><Title level={4} style={{ margin: 0 }}>{run.modelName || run.name}</Title></Tooltip>
          <Text type="secondary">{run.name}</Text>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Tag color={STATUS_COLOR[run.status] || 'default'}>{STATUS_LABEL[run.status] || run.status}</Tag>
          <Link to={`/eval/live/${run.id}`}><Button type="primary">打开完整实时详情</Button></Link>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <Progress
          percent={progressPercent}
          strokeColor={strokeColor}
          format={() => `${run.completed}/${run.total || '?'}`}
        />
      </div>

      <Row gutter={[12, 12]}>
        <Col span={8}>
          <Statistic title="综合分" value={avg != null ? Number(avg.toFixed(2)) : '—'} valueStyle={{ fontSize: 20 }} />
        </Col>
        <Col span={8}>
          <Statistic
            title="通过"
            value={passCount != null ? passCount : '—'}
            suffix={run.summary ? `/ ${run.summary.totalScenarios}` : ''}
            valueStyle={{ fontSize: 20 }}
          />
        </Col>
        <Col span={8}>
          <Statistic title="耗时" value={formatDuration(liveDuration)} valueStyle={{ fontSize: 20 }} />
        </Col>
      </Row>

      {run.summary?.dimensionAverages && Object.keys(run.summary.dimensionAverages).length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>维度均分</Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {Object.entries(run.summary.dimensionAverages).map(([dim, score]) => (
              <Tag key={dim} style={{ fontSize: 11, margin: 0 }}>
                {dim}: {Number((score as number).toFixed(1))}
              </Tag>
            ))}
          </div>
        </div>
      )}

      {run.dimensionProgress && run.dimensionProgress.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <Text strong>各维度进度</Text>
          <Row gutter={[12, 12]} style={{ marginTop: 10 }}>
            {run.dimensionProgress.map((dimension) => {
              const percent = dimension.total > 0 ? Math.round((dimension.completed / dimension.total) * 100) : 0;
              return (
                <Col xs={24} md={12} xl={8} key={dimension.dimension}>
                  <Card size="small" bordered>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                      <Text ellipsis={{ tooltip: dimension.dimension }}>{dimension.dimension}</Text>
                      <Text type="secondary">{dimension.completed}/{dimension.total}</Text>
                    </div>
                    <Progress percent={percent} size="small" showInfo={false} />
                    <div style={{ display: 'flex', gap: 10, fontSize: 12, marginTop: 6 }}>
                      <Text type="success">通过 {dimension.passed}</Text>
                      <Text type="danger">未通过 {dimension.failed}</Text>
                      <Text type="secondary">均分 {Number(dimension.avgScore.toFixed(1))}</Text>
                    </div>
                  </Card>
                </Col>
              );
            })}
          </Row>
        </div>
      )}

      {run.status === 'failed' && (
        <Alert type="error" showIcon style={{ marginTop: 12 }} message="该模型评测失败，不影响其他模型。可进入详情页查看或重试。" />
      )}
    </div>
  );
}
