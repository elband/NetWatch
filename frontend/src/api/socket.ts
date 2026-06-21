import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

// Cookie sesi HttpOnly dikirim otomatis pada handshake (withCredentials);
// server menggabungkan socket ke room user:{id} berdasarkan cookie tsb.
export function getSocket(): Socket {
  if (!socket) {
    socket = io('/', { path: '/socket.io', transports: ['websocket'], withCredentials: true });
  }
  return socket;
}

export function getSshSocket(): Socket {
  return io('/ssh', { transports: ['websocket'], withCredentials: true });
}
