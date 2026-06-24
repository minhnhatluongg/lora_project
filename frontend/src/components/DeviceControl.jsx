const ICONS = {
  pump: '🚰',
  van1: '🔧',
  van2: '🔧',
  van3: '🔧',
  van4: '🔧',
};

export function DeviceControl({ devices, mode, readOnly = false, onToggle, onSetMode }) {
  // Manual buttons are off when in AUTO mode OR when the user can't control.
  const disabled = mode === 'AUTO' || readOnly;

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Điều khiển thiết bị</h3>
        <div className="mode-switch">
          <span>CHẾ ĐỘ</span>
          <button
            className={`mode-btn ${mode === 'AUTO' ? 'mode-active' : ''}`}
            disabled={readOnly}
            onClick={() => onSetMode('AUTO')}
          >
            AUTO
          </button>
          <button
            className={`mode-btn ${mode === 'MANUAL' ? 'mode-active' : ''}`}
            disabled={readOnly}
            onClick={() => onSetMode('MANUAL')}
          >
            MANUAL
          </button>
        </div>
      </div>

      <div className="device-grid">
        {(devices || []).map((d) => {
          const on = d.state === 'ON';
          return (
            <div key={d.id} className="device-card">
              <div className="device-icon">{ICONS[d.id] || '🔧'}</div>
              <span className="device-name">{d.name}</span>
              <button
                className={`device-btn ${on ? 'btn-on' : 'btn-off'}`}
                disabled={disabled}
                title={disabled ? 'Chuyển sang MANUAL để điều khiển' : ''}
                onClick={() => onToggle(d.id, d.state)}
              >
                {on ? 'ON' : 'OFF'}
              </button>
            </div>
          );
        })}
      </div>
      {readOnly ? (
        <p className="hint">Bạn chỉ có quyền xem — không thể điều khiển thiết bị.</p>
      ) : (
        mode === 'AUTO' && (
          <p className="hint">Đang ở chế độ AUTO — chuyển sang MANUAL để điều khiển tay.</p>
        )
      )}
    </div>
  );
}
