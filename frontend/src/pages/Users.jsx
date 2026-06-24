import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ROLE_LABEL } from '../auth/AuthContext.jsx';

const ROLES = ['admin', 'technician', 'viewer'];
const EMPTY = { username: '', password: '', fullName: '', role: 'viewer' };

export function Users() {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [msg, setMsg] = useState('');

  const load = () => api.users().then(setUsers).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    setMsg('');
    try {
      await api.createUser(form);
      setForm(EMPTY);
      setMsg('✅ Đã tạo tài khoản');
      load();
    } catch (err) {
      setMsg('❌ ' + err.message);
    }
  };

  const changeRole = async (u, role) => {
    try { await api.updateUser(u.id, { role }); load(); }
    catch (e) { setMsg('❌ ' + e.message); }
  };

  const toggleActive = async (u) => {
    try { await api.updateUser(u.id, { active: !u.active }); load(); }
    catch (e) { setMsg('❌ ' + e.message); }
  };

  const resetPassword = async (u) => {
    const pw = prompt(`Mật khẩu mới cho "${u.username}":`);
    if (!pw) return;
    try { await api.updateUser(u.id, { password: pw }); setMsg('✅ Đã đổi mật khẩu'); }
    catch (e) { setMsg('❌ ' + e.message); }
  };

  const remove = async (u) => {
    if (!confirm(`Xóa tài khoản "${u.username}"?`)) return;
    try { await api.deleteUser(u.id); load(); }
    catch (e) { setMsg('❌ ' + e.message); }
  };

  return (
    <>
      <div className="page-head"><h1>Quản lý người dùng</h1></div>
      {msg && <div className="form-msg">{msg}</div>}

      <div className="panel">
        <h3>Cấp tài khoản mới</h3>
        <form className="user-form" onSubmit={create}>
          <input
            placeholder="Tên đăng nhập"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            required
          />
          <input
            placeholder="Họ tên"
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          />
          <input
            type="password"
            placeholder="Mật khẩu"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select>
          <button type="submit" className="primary-btn">Tạo</button>
        </form>
      </div>

      <div className="panel">
        <h3>Danh sách tài khoản</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tài khoản</th>
                <th>Họ tên</th>
                <th>Vai trò</th>
                <th>Trạng thái</th>
                <th>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td>{u.fullName || '—'}</td>
                  <td>
                    <select value={u.role} onChange={(e) => changeRole(u, e.target.value)}>
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <span className={`badge ${u.active ? 'badge-on' : 'badge-off'}`}>
                      {u.active ? 'Hoạt động' : 'Đã khóa'}
                    </span>
                  </td>
                  <td className="row-actions">
                    <button onClick={() => toggleActive(u)}>{u.active ? 'Khóa' : 'Mở'}</button>
                    <button onClick={() => resetPassword(u)}>Đổi MK</button>
                    <button className="danger" onClick={() => remove(u)}>Xóa</button>
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
