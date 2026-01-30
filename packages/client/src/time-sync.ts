import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageTypes, type ClientMessage, type HostMessage } from '@party-kit/core';

interface TimeSyncState {
  offset: number;  // Difference between server time and local time
  rtt: number;     // Round Trip Time
}

// Pure logic for testing
export function calculateTimeSync(
  clientSendTime: number, 
  clientReceiveTime: number, 
  serverTime: number
) {
  const rtt = clientReceiveTime - clientSendTime;
  const latency = rtt / 2;
  const expectedServerTime = serverTime + latency;
  const offset = expectedServerTime - clientReceiveTime;
  
  return { offset, rtt };
}

export function useServerTime(socket: WebSocket | null) {
  const [timeSync, setTimeSync] = useState<TimeSyncState>({ offset: 0, rtt: 0 });
  
  // Ref to track ping timestamps
  const pings = useRef<Map<string, number>>(new Map());

  // Function to get current server time
  const getServerTime = useCallback(() => {
    return Date.now() + timeSync.offset;
  }, [timeSync.offset]);

  // Handle PONG messages
  const handlePong = useCallback((payload: { id: string, origTimestamp: number, serverTime: number }) => {
    const now = Date.now();
    const sentTime = pings.current.get(payload.id);
    
    if (sentTime) {
      const { offset, rtt } = calculateTimeSync(sentTime, now, payload.serverTime);
      setTimeSync({ offset, rtt });
      pings.current.delete(payload.id);
    }
  }, []);

  // Periodic Sync
  useEffect(() => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    const sync = () => {
      const id = Math.random().toString(36).substring(7);
      const timestamp = Date.now();
      pings.current.set(id, timestamp);
      
      socket.send(JSON.stringify({
        type: MessageTypes.PING,
        payload: { id, timestamp }
      }));
    };

    // Initial sync
    sync();

    // Sync every 5 seconds
    const interval = setInterval(sync, 5000);
    return () => clearInterval(interval);
  }, [socket]);

  return { getServerTime, rtt: timeSync.rtt, handlePong };
}
