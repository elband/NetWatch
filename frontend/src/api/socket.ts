import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io('/', { path: '/socket.io', transports: ['websocket'] });
  }
  return socket;
}

export function getSshSocket(token: string): Socket {
  return io('/ssh', { auth: { token }, transports: ['websocket'] });
}
