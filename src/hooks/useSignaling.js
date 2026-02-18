import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabaseClient";

const MISSING_CALL_STATUS_TABLE_PATTERN =
  "Could not find the table 'public.call_status'";
const MISSING_SIGNALS_TABLE_PATTERN =
  "Could not find the table 'public.signals'";

export function useSignaling(roomName, enabled) {
  const [roomFull, setRoomFull] = useState(false);
  const [participantCount, setParticipantCount] = useState(0);
  const [callStatus, setCallStatusState] = useState("idle");
  const [callStatusSender, setCallStatusSender] = useState(null);
  const [ready, setReady] = useState(false);
  const signalHandlerRef = useRef(null);
  const statusHandlerRef = useRef(null);
  const userIdRef = useRef(crypto.randomUUID());
  const channelRef = useRef(null);
  const hasCallStatusTableRef = useRef(true);
  const hasSignalsTableRef = useRef(true);
  const missingCallStatusLoggedRef = useRef(false);
  const missingSignalsLoggedRef = useRef(false);

  const userId = userIdRef.current;
  const channelName = useMemo(() => `private-call:${roomName}`, [roomName]);

  const registerSignalHandler = useCallback((handler) => {
    signalHandlerRef.current = handler;
  }, []);

  const registerStatusHandler = useCallback((handler) => {
    statusHandlerRef.current = handler;
  }, []);

  const publishSignalBroadcast = useCallback(
    async (type, payload) => {
      if (!channelRef.current) {
        return;
      }
      await channelRef.current.send({
        type: "broadcast",
        event: "signal",
        payload: { type, payload, sender: userId },
      });
    },
    [userId],
  );

  const publishSignal = useCallback(
    async (type, payload) => {
      if (!hasSignalsTableRef.current) {
        await publishSignalBroadcast(type, payload);
        return;
      }

      const { error } = await supabase.from("signals").insert({
        type,
        payload,
        sender: userId,
      });

      if (!error) {
        return;
      }

      if (error.message?.includes(MISSING_SIGNALS_TABLE_PATTERN)) {
        hasSignalsTableRef.current = false;
        if (!missingSignalsLoggedRef.current) {
          missingSignalsLoggedRef.current = true;
          console.warn(
            "signals table missing in Supabase schema cache. Falling back to Realtime broadcast signaling. Run supabase/schema.sql or supabase/fix_signals.sql.",
          );
        }
        await publishSignalBroadcast(type, payload);
        return;
      }

      if (error) {
        console.error("Failed to publish signal:", error.message);
      }
    },
    [publishSignalBroadcast, userId],
  );

  const publishCallStatusBroadcast = useCallback(
    async (status) => {
      if (!channelRef.current) {
        return;
      }
      await channelRef.current.send({
        type: "broadcast",
        event: "call_status",
        payload: { status, sender: userId },
      });
    },
    [userId],
  );

  const clearSignals = useCallback(async () => {
    if (!hasSignalsTableRef.current) {
      return;
    }

    const { error } = await supabase
      .from("signals")
      .delete()
      .lt("created_at", new Date(Date.now() + 60_000).toISOString());

    if (error?.message?.includes(MISSING_SIGNALS_TABLE_PATTERN)) {
      hasSignalsTableRef.current = false;
      if (!missingSignalsLoggedRef.current) {
        missingSignalsLoggedRef.current = true;
        console.warn(
          "signals table missing in Supabase schema cache. Falling back to Realtime broadcast signaling. Run supabase/schema.sql or supabase/fix_signals.sql.",
        );
      }
      return;
    }

    if (error) {
      console.error("Failed to clear signals:", error.message);
    }
  }, []);

  const updateCallStatus = useCallback(
    async (status) => {
      // Keep local UI responsive regardless of database path.
      setCallStatusState(status);
      setCallStatusSender(userId);

      if (!hasCallStatusTableRef.current) {
        await publishCallStatusBroadcast(status);
        return;
      }

      const { error } = await supabase.from("call_status").upsert(
        {
          id: 1,
          status,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );

      if (!error) {
        await publishCallStatusBroadcast(status);
        return;
      }

      if (error.message?.includes(MISSING_CALL_STATUS_TABLE_PATTERN)) {
        hasCallStatusTableRef.current = false;
        if (!missingCallStatusLoggedRef.current) {
          missingCallStatusLoggedRef.current = true;
          console.warn(
            "call_status table missing in Supabase schema cache. Falling back to Realtime broadcast. Run supabase/schema.sql to restore DB-backed call_status.",
          );
        }
        await publishCallStatusBroadcast(status);
        return;
      }

      console.error("Failed to update call status:", error.message);
    },
    [publishCallStatusBroadcast, userId],
  );

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    let subscribed = true;
    const channel = supabase.channel(channelName, {
      config: { presence: { key: userId } },
    });
    channelRef.current = channel;

    const syncPresence = () => {
      const state = channel.presenceState();
      const count = Object.keys(state).length;
      setParticipantCount(count);
      if (count > 2) {
        setRoomFull(true);
      }
    };

    channel
      .on("presence", { event: "sync" }, syncPresence)
      .on("broadcast", { event: "signal" }, (payload) => {
        const signal = payload?.payload;
        if (!signal || signal.sender === userId || !subscribed) {
          return;
        }
        signalHandlerRef.current?.(signal);
      })
      .on("broadcast", { event: "call_status" }, (payload) => {
        const status = payload?.payload?.status;
        const sender = payload?.payload?.sender ?? null;
        if (!status) {
          return;
        }
        setCallStatusState(status);
        setCallStatusSender(sender);
        statusHandlerRef.current?.(status);
      })
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "signals" },
        (payload) => {
          const row = payload.new;
          if (row.sender === userId || !subscribed) {
            return;
          }
          signalHandlerRef.current?.(row);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "call_status" },
        (payload) => {
          const row = payload.new;
          if (!row) {
            return;
          }
          setCallStatusState(row.status);
          setCallStatusSender(null);
          statusHandlerRef.current?.(row.status);
        },
      )
      .subscribe(async (status) => {
        if (status !== "SUBSCRIBED") {
          return;
        }
        await channel.track({ joinedAt: new Date().toISOString() });
        syncPresence();
        if (Object.keys(channel.presenceState()).length > 2) {
          setRoomFull(true);
          await channel.untrack();
          setReady(false);
          return;
        }
        setReady(true);
      });

    const loadStatus = async () => {
      if (!hasCallStatusTableRef.current) {
        return;
      }

      const { data, error } = await supabase
        .from("call_status")
        .select("status")
        .eq("id", 1)
        .maybeSingle();

      if (error) {
        if (error.message?.includes(MISSING_CALL_STATUS_TABLE_PATTERN)) {
          hasCallStatusTableRef.current = false;
          if (!missingCallStatusLoggedRef.current) {
            missingCallStatusLoggedRef.current = true;
            console.warn(
              "call_status table missing in Supabase schema cache. Falling back to Realtime broadcast. Run supabase/schema.sql to restore DB-backed call_status.",
            );
          }
          return;
        }
        console.error("Failed to load call status:", error.message);
        return;
      }

      if (data?.status) {
        setCallStatusState(data.status);
        setCallStatusSender(null);
      }
    };
    loadStatus();

    return () => {
      subscribed = false;
      setReady(false);
      setParticipantCount(0);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
      channelRef.current = null;
    };
  }, [channelName, enabled, userId]);

  return {
    userId,
    ready,
    roomFull,
    participantCount,
    callStatus,
    callStatusSender,
    registerSignalHandler,
    registerStatusHandler,
    publishSignal,
    clearSignals,
    updateCallStatus,
  };
}
