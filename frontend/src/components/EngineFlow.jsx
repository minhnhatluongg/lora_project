// Dải tiến trình của hai máy trạng thái chạy trên ESP32.
//
// Ở chế độ TỰ ĐỘNG, màn CONTROL trước đây chỉ còn chữ "TỰ ĐỘNG" và chín công
// tắc xám — người vận hành không có cách nào biết hệ thống đang làm gì, hay vì
// sao nó chưa tưới. Mà "vì sao chưa tưới" gần như luôn là câu hỏi đầu tiên.
//
// Hai máy nối tiếp nhau: pha phân phải xong (isMixingReady) thì tưới mới được
// khởi động. Vẽ đúng quan hệ đó thay vì hai danh sách rời rạc.
//
// Bố cục: thanh phân đoạn cho biết ĐANG Ở ĐÂU trong chuỗi, nhãn nằm CÙNG HÀNG
// cho biết đang làm GÌ. Ban đầu mỗi bước có nhãn riêng bên dưới, nhưng trên
// panel 1024x600 phần nhãn đó đẩy khối VAN xuống quá đáy màn hình.

// Gom các bước theo VIỆC người vận hành nhìn thấy, không theo từng trạng thái
// máy. Firmware tách "ra lệnh bật bơm" và "đang bơm" thành hai trạng thái vì nó
// phải chờ Nano xác nhận, nhưng với người đứng xem thì đó vẫn là một việc.
const MIX_STEPS = [
  { key: 'water', label: 'Bơm nước vào bồn trộn',
    match: ['MIX_START_PUMP3', 'MIX_PUMPING_WATER', 'MIX_STOP_PUMP3'] },
  { key: 'measure', label: 'Đo EC',
    match: ['MIX_WAIT_STABLE'] },
  { key: 'dose', label: 'Châm Đạm + Kali',
    match: ['MIX_START_DOSING', 'MIX_DOSING_NUTRIENT', 'MIX_STOP_DOSING'] },
];

const AUTO_STEPS = [
  { key: 'idle', label: 'Chờ đất khô', match: ['AUTO_IDLE'] },
  { key: 'open', label: 'Mở van', match: ['AUTO_OPEN_VALVE', 'AUTO_WAIT_VALVE_ON'] },
  { key: 'water', label: 'Đang tưới', match: ['AUTO_WAIT_PUMP_ON', 'AUTO_IRRIGATING'] },
  { key: 'close', label: 'Đóng van', match: ['AUTO_WAIT_PUMP_OFF', 'AUTO_WAIT_VALVE_OFF'] },
  { key: 'rest', label: 'Nghỉ thấm nước', match: ['AUTO_WAIT_RESTING_CMD', 'AUTO_RESTING'] },
];

function Track({ title, steps, current, done, doneLabel }) {
  const activeIdx = steps.findIndex((s) => s.match.includes(current));
  const active = activeIdx >= 0 ? steps[activeIdx] : null;

  return (
    <div className="eflow-track">
      <span className="eflow-track-title">{title}</span>

      {/* Vị trí trong chuỗi. aria-label nói thành câu để trình đọc màn hình
          không phải đọc từng ô một. */}
      <span
        className="eflow-bar"
        role="img"
        aria-label={
          done
            ? `${title}: ${doneLabel}`
            : `${title}: bước ${activeIdx + 1} trên ${steps.length}, ${active?.label ?? 'không rõ'}`
        }
      >
        {steps.map((s, i) => {
          const state = done ? 'past' : i === activeIdx ? 'now' : i < activeIdx ? 'past' : 'next';
          return <span key={s.key} className={`eflow-seg is-${state}`} />;
        })}
      </span>

      <span className={`eflow-now${done ? ' is-done' : ''}`}>
        {done ? `✓ ${doneLabel}` : (active?.label ?? '—')}
      </span>
    </div>
  );
}

export function EngineFlow({ status }) {
  const mixState = status?.mixState || null;
  const autoState = status?.autoState || null;
  const mixReady = !!status?.mixReady;

  // Máy trạng thái sống trên ESP32. Nếu master chưa từng báo về thì nói thẳng
  // là chưa biết, thay vì vẽ một dải trông như đang chạy.
  if (!mixState && !autoState) {
    return (
      <p className="eflow-empty">
        Chưa nhận được báo cáo tiến trình từ ESP32. Dải này hiện lên ngay khi master báo về.
      </p>
    );
  }

  return (
    <div className="eflow">
      <Track
        title="Pha phân"
        steps={MIX_STEPS}
        current={mixState}
        done={mixReady}
        doneLabel="đạt chuẩn EC"
      />
      <p className={`eflow-gate${mixReady ? ' is-open' : ''}`}>
        {mixReady ? 'Dung dịch sẵn sàng → cho phép tưới' : 'Chưa pha xong → khoá tưới'}
      </p>
      <Track title="Tưới" steps={AUTO_STEPS} current={autoState} done={false} />
    </div>
  );
}

export default EngineFlow;
