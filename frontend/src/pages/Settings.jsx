import { useEffect, useState } from 'react';
import { api } from '../api.js';

const METRICS = [
  { value: 'temperature', label: 'Nhiệt độ (°C)' },
  { value: 'humidity', label: 'Độ ẩm (%)' },
  { value: 'ph', label: 'pH' },
  { value: 'ec', label: 'EC (mS/cm)' },
];

const DEVICE_LABEL = {
  pump: 'Bơm nước',
  van1: 'Van 1',
  van2: 'Van 2',
  van3: 'Van 3',
  van4: 'Van 4',
};

export function Settings() {
  const [cfg, setCfg] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getConfig().then(setCfg).catch((e) => setMsg(e.message));
  }, []);

  if (!cfg) return <div className="panel">Đang tải cấu hình…</div>;

  const setThreshold = (k, v) =>
    setCfg({ ...cfg, thresholds: { ...cfg.thresholds, [k]: Number(v) } });

  const setRule = (dev, patch) =>
    setCfg({
      ...cfg,
      automation: { ...cfg.automation, [dev]: { ...cfg.automation[dev], ...patch } },
    });

  const save = async () => {
    setBusy(true);
    setMsg('');
    try {
      const saved = await api.updateConfig(cfg);
      setCfg(saved);
      setMsg('✅ Đã lưu cấu hình');
    } catch (e) {
      setMsg('❌ ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  const T = cfg.thresholds;

  return (
    <>
      <div className="page-head">
        <h1>Cài đặt & Tự động</h1>
        <button className="primary-btn" onClick={save} disabled={busy}>
          {busy ? 'Đang lưu…' : 'Lưu thay đổi'}
        </button>
      </div>
      {msg && <div className="form-msg">{msg}</div>}

      <div className="panel">
        <h3>Ngưỡng cảnh báo</h3>
        <div className="threshold-grid">
          <Field label="pH tối thiểu" value={T.phMin} onChange={(v) => setThreshold('phMin', v)} />
          <Field label="pH tối đa" value={T.phMax} onChange={(v) => setThreshold('phMax', v)} />
          <Field label="EC tối đa (mS/cm)" value={T.ecMax} onChange={(v) => setThreshold('ecMax', v)} />
          <Field label="Nhiệt độ tối đa (°C)" value={T.tempMax} onChange={(v) => setThreshold('tempMax', v)} />
          <Field label="Độ ẩm tối thiểu (%)" value={T.humidityMin} onChange={(v) => setThreshold('humidityMin', v)} />
        </div>
      </div>

      <div className="panel">
        <h3>Luật tự động (chế độ AUTO)</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          Khi ở chế độ AUTO, hệ thống sẽ BẬT thiết bị khi điều kiện đúng, ngược lại TẮT.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Thiết bị</th>
                <th>Bật luật</th>
                <th>Cảm biến</th>
                <th>Điều kiện</th>
                <th>Ngưỡng</th>
                <th>Diễn giải</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(cfg.automation).map(([dev, rule]) => (
                <tr key={dev}>
                  <td>{DEVICE_LABEL[dev] || dev}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={(e) => setRule(dev, { enabled: e.target.checked })}
                    />
                  </td>
                  <td>
                    <select
                      value={rule.metric}
                      onChange={(e) => setRule(dev, { metric: e.target.value })}
                    >
                      {METRICS.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={rule.op}
                      onChange={(e) => setRule(dev, { op: e.target.value })}
                    >
                      <option value="below">nhỏ hơn (&lt;)</option>
                      <option value="above">lớn hơn (&gt;)</option>
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.1"
                      className="num-input"
                      value={rule.value}
                      onChange={(e) => setRule(dev, { value: Number(e.target.value) })}
                    />
                  </td>
                  <td className="rule-desc">
                    BẬT khi {METRICS.find((m) => m.value === rule.metric)?.label}{' '}
                    {rule.op === 'below' ? '<' : '>'} {rule.value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Field({ label, value, onChange }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        step="0.1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
