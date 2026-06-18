import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io('/', { path: '/socket.io', transports: ['websocket'] });
    // Kirim token agar server menggabungkan socket ke room user:{id} (Notification Center).
    const authenticate = () => {
      const t = localStorage.getItem('netwatch_token');
      if (t) socket!.emit('notif:auth', t);
    };
    socket.on('connect', authenticate);
    if (socket.connected) authenticate();
  }
  return socket;
}

export function getSshSocket(token: string): Socket {
  return io('/ssh', { auth: { token }, transports: ['websocket'] });
}
