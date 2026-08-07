import { useEffect, useState } from 'react';
import { api } from '../api.js';
import {
  METRICS,
  TANK_IDS,
  AUTOMATION_METRIC_GROUPS,
  tankLevelPct,
} from '../metrics.js';

const DEVICE_LABEL = {
  pump: 'Bơm nước',
  van1: 'Van 1',
  van2: 'Van 2',
  van3: 'Van 3',
  van4: 'Van 4',
};

const THRESHOLD_FIELDS = [
  { key: 'phMin', label: 'pH tối thiểu', step: 0.1 },
  { key: 'phMax', label: 'pH tối đa', step: 0.1 },
  { key: 'ecMax', label: 'EC tối đa (µS/cm)', step: 50 },
  { key: 'tempMax', label: 'Nhiệt độ tối đa (°C)', step: 0.5 },
  { key: 'humidityMin', label: 'Độ ẩm đất tối thiểu (%)', step: 1 },
  { key: 'nMin', label: 'Đạm N tối thiểu (ppm)', step: 5 },
  { key: 'pMin', label: 'Lân P tối thiểu (ppm)', step: 5 },
  { key: 'kMin', label: 'Kali K tối thiểu (ppm)', step: 5 },
  { key: 'tankLowPct', label: 'Mức nước cạn (%)', step: 1 },
];

export function Settings() {
  const [cfg, setCfg] = useState(null);
  const [latest, setLatest] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getConfig().then(setCfg).catch((e) => setMsg('❌ ' + e.message));
    // Used to preview each tank's calibration against a real reading.
    api.latest().then(setLatest).catch(() => {});
  }, []);

  if (!cfg) return <div className="panel">Đang tải cấu hình…</div>;

  const setThreshold = (k, v) =>
    setCfg({ ...cfg, thresholds: { ...cfg.thresholds, [k]: Number(v) } });

  const setTank = (id, patch) =>
    setCfg({ ...cfg, tanks: { ...cfg.tanks, [id]: { ...cfg.tanks[id], ...patch } } });

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

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Cài đặt &amp; Tự động</h1>
          <p className="page-sub">Ngưỡng cảnh báo, hiệu chuẩn bồn nước và luật điều khiển AUTO</p>
        </div>
        <button className="primary-btn" onClick={save} disabled={busy}>
          {busy ? 'Đang lưu…' : 'Lưu thay đổi'}
        </button>
      </div>
      {msg && <div className="form-msg">{msg}</div>}

      <div className="panel">
        <h3>Ngưỡng cảnh báo</h3>
        <div className="threshold-grid">
          {THRESHOLD_FIELDS.map((f) => (
            <Field
              key={f.key}
              label={f.label}
              step={f.step}
              value={cfg.thresholds[f.key]}
              onChange={(v) => setThreshold(f.key, v)}
            />
          ))}
        </div>
        <p className="hint">
          EC dùng đơn vị <strong>µS/cm</strong> — đúng giá trị thô đầu dò RS485 trả về
          (1000 µS/cm = 1 mS/cm).
        </p>
      </div>

      <div className="panel">
        <h3>Hiệu chuẩn bồn nước (cảm biến siêu âm)</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          Cảm biến đo <em>khoảng cách từ đầu dò xuống mặt nước</em>. Đo thực tế 2 lần —
          lúc bồn cạn và lúc bồn đầy — rồi điền vào đây. Mức nước % ={' '}
          <code>(cạn − đo được) / (cạn − đầy) × 100</code>.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Cảm biến</th>
                <th>Tên hiển thị</th>
                <th>Bật</th>
                <th className="num">Khi cạn (cm)</th>
                <th className="num">Khi đầy (cm)</th>
                <th>Đọc hiện tại</th>
              </tr>
            </thead>
            <tbody>
              {TANK_IDS.map((id, i) => {
                const tank = cfg.tanks[id] || {};
                const distance = latest?.[id];
                const preview = tankLevelPct(distance, tank);
                const invalid = tank.emptyCm <= tank.fullCm;
                return (
                  <tr key={id}>
                    <td>{METRICS[id].short}</td>
                    <td>
                      <input
                        value={tank.name || ''}
                        onChange={(e) => setTank(id, { name: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={tank.enabled !== false}
                        onChange={(e) => setTank(id, { enabled: e.target.checked })}
                      />
                    </td>
                    <td className="num">
                      <input
                        type="number"
                        className="num-input"
                        value={tank.emptyCm}
                        onChange={(e) => setTank(id, { emptyCm: Number(e.target.value) })}
                      />
                    </td>
                    <td className="num">
                      <input
                        type="number"
                        className="num-input"
                        value={tank.fullCm}
                        onChange={(e) => setTank(id, { fullCm: Number(e.target.value) })}
                      />
                    </td>
                    <td className="rule-desc">
                      {invalid
                        ? '⚠ "Khi cạn" phải lớn hơn "khi đầy"'
                        : distance == null
                          ? 'Không có tín hiệu'
                          : `${distance} cm → ${preview}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h3>Luật tự động (chế độ AUTO)</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          Khi ở chế độ AUTO, mỗi lần có dữ liệu mới hệ thống sẽ BẬT thiết bị nếu điều kiện
          đúng, ngược lại TẮT — rồi đẩy lệnh xuống ESP32.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Thiết bị</th>
                <th>Bật luật</th>
                <th>Cảm biến</th>
                <th>Điều kiện</th>
                <th className="num">Ngưỡng</th>
                <th>Diễn giải</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(cfg.automation).map(([dev, rule]) => {
                const m = METRICS[rule.metric];
                return (
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
                        {AUTOMATION_METRIC_GROUPS.map((g) => (
                          <optgroup key={g.label} label={g.label}>
                            {g.keys.map((k) => (
                              <option key={k} value={k}>
                                {METRICS[k].label}
                                {METRICS[k].unit ? ` (${METRICS[k].unit})` : ''}
                              </option>
                            ))}
                          </optgroup>
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
                    <td className="num">
                      <input
                        type="number"
                        step="0.1"
                        className="num-input"
                        value={rule.value}
                        onChange={(e) => setRule(dev, { value: Number(e.target.value) })}
                      />
                    </td>
                    <td className="rule-desc">
                      BẬT khi {m?.label || rule.metric} {rule.op === 'below' ? '<' : '>'}{' '}
                      {rule.value}
                      {m?.unit ? ` ${m.unit}` : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Field({ label, value, step = 0.1, onChange }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
