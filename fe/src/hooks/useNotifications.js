import { useCallback, useEffect, useRef, useState } from 'react';
import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('1234567890abcdef', 10);

export const NOTIFICATION_TYPES = {
    INFO: 'info',
    SUCCESS: 'success',
    WARNING: 'warning',
    ERROR: 'error'
};

// Notifications with auto-dismiss; timers are kept to clear on close/unmount.
export function useNotifications() {
    const [notifications, setNotifications] = useState([]);
    const timers = useRef(new Map());

    const removeNotification = useCallback((id) => {
        setNotifications(prev => prev.filter(n => n.id !== id));
        const timer = timers.current.get(id);
        if (timer) {
            clearTimeout(timer);
            timers.current.delete(id);
        }
    }, []);

    const addNotification = useCallback((message, type = NOTIFICATION_TYPES.ERROR) => {
        const id = nanoid();
        setNotifications(prev => [...prev, { id, message, type }]);
        const timer = setTimeout(() => removeNotification(id), 5000);
        timers.current.set(id, timer);
        return () => removeNotification(id);
    }, [removeNotification]);

    useEffect(() => () => {
        timers.current.forEach(clearTimeout);
        timers.current.clear();
    }, []);

    return { notifications, addNotification, removeNotification };
}
