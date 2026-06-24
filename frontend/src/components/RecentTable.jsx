function fmt(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString('vi-VN', { hour12: false });
}

export function RecentTable({ rows }) {
  return (
    <div className="panel">
      <h3>Dữ liệu mới nhất</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Thời gian</th>
              <th>Nhiệt độ (°C)</th>
              <th>Độ ẩm (%)</th>
              <th>pH</th>
              <th>EC (mS/cm)</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((r) => (
              <tr key={r.id}>
                <td>{fmt(r.created_at)}</td>
                <td>{r.temperature}</td>
                <td>{r.humidity}</td>
                <td>{r.ph}</td>
                <td>{r.ec}</td>
              </tr>
            ))}
            {(!rows || rows.length === 0) && (
              <tr>
                <td colSpan="5" className="empty">Chưa có dữ liệu</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
