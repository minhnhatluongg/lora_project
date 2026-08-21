import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { socket, EVENTS } from '../socket.js';
import { useAuth } from '../auth/AuthContext.jsx';

// Con số cho huy hiệu đỏ, dùng chung cho cả ô CÔNG VIỆC ở MENU lẫn thanh tài
// khoản. Đặt ở một chỗ vì hai nơi đó luôn phải nói cùng một con số — mỗi nơi tự
// gọi API riêng thì có lúc chúng lệch nhau, mà lệch ở đây nghĩa là người dùng
// nhìn thấy "2 việc" chỗ này và "3 việc" chỗ kia.
const TaskBadgeCtx = createContext(null);

const EMPTY = { open: 0, unseen: 0, overdue: 0, high: 0, assignedOverdue: 0, canAssign: false };

export function TaskBadgeProvider({ children }) {
  const { user } = useAuth();
  const [summary, setSummary] = useState(EMPTY);
  const lastFetch = useRef(0);

  const refresh = useCallback(async () => {
    if (!user) return;
    lastFetch.current = Date.now();
    try {
      setSummary(await api.taskSummary());
    } catch {
      // Mất mạng hay hết phiên thì giữ nguyên con số cũ. Nhảy về 0 còn tệ hơn:
      // đó là lời khẳng định "bạn không còn việc nào", trong khi sự thật là ta
      // vừa không hỏi được.
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setSummary(EMPTY);
      return undefined;
    }
    refresh();

    // Chuông từ server: ai đó vừa tạo/sửa/xóa việc. Không biết là việc của ai
    // nên cứ hỏi lại — câu trả lời đã được lọc theo token của chính mình.
    const onPing = () => refresh();
    socket.on(EVENTS.TASKS, onPing);

    // Quay lại tab thì hỏi lại. Bảng điều khiển hay bị để mở hàng giờ; thiếu
    // cái này thì huy hiệu đứng im từ lúc mở trang cho tới lúc tải lại.
    // Chặn dưới 5 giây để chuyển qua chuyển lại tab không thành một tràng gọi.
    const onFocus = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastFetch.current < 5000) return;
      refresh();
    };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);

    return () => {
      socket.off(EVENTS.TASKS, onPing);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [user, refresh]);

  return (
    <TaskBadgeCtx.Provider value={{ summary, refresh }}>{children}</TaskBadgeCtx.Provider>
  );
}

// Trả về giá trị rỗng thay vì ném lỗi khi nằm ngoài provider, để một trang lẻ
// dựng trong bài kiểm thử không chết chỉ vì thiếu bọc ngoài.
export const useTaskBadge = () => useContext(TaskBadgeCtx) || { summary: EMPTY, refresh: () => {} };
