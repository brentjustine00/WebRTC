import { useCallback, useEffect, useRef, useState } from "react";

const MEDIA_CONSTRAINTS = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
  },
  video: {
    width: { ideal: 640, max: 854 },
    height: { ideal: 360, max: 480 },
    frameRate: { ideal: 15, max: 20 },
  },
};

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

export function useWebRTC({ enabled, publishSignal, clearSignals }) {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const remoteDescriptionSetRef = useRef(false);
  const pendingCandidatesRef = useRef([]);
  const reconnectLockRef = useRef(false);
  const attemptReconnectRef = useRef(async () => {});
  const isMountedRef = useRef(true);

  const [mediaReady, setMediaReady] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [connectionState, setConnectionState] = useState("new");
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [error, setError] = useState("");

  const attachRemoteStream = useCallback(() => {
    if (!remoteStreamRef.current) {
      remoteStreamRef.current = new MediaStream();
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStreamRef.current;
    }
  }, []);

  const setPcListeners = useCallback(
    (pc) => {
      pc.onicecandidate = async (event) => {
        if (event.candidate) {
          await publishSignal("candidate", event.candidate.toJSON());
        }
      };

      pc.ontrack = (event) => {
        attachRemoteStream();
        const [stream] = event.streams;
        if (stream) {
          remoteVideoRef.current.srcObject = stream;
          remoteStreamRef.current = stream;
          return;
        }
        event.track && remoteStreamRef.current?.addTrack(event.track);
      };

      pc.onconnectionstatechange = () => {
        setConnectionState(pc.connectionState);
        if (
          pc.connectionState === "disconnected" ||
          pc.connectionState === "failed" ||
          pc.connectionState === "closed"
        ) {
          void attemptReconnectRef.current();
        }
        if (pc.connectionState === "connected") {
          setInCall(true);
          void clearSignals();
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (
          pc.iceConnectionState === "disconnected" ||
          pc.iceConnectionState === "failed" ||
          pc.iceConnectionState === "closed"
        ) {
          void attemptReconnectRef.current();
        }
      };
    },
    [attachRemoteStream, clearSignals, publishSignal],
  );

  const buildPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;
    remoteDescriptionSetRef.current = false;
    pendingCandidatesRef.current = [];
    attachRemoteStream();
    setPcListeners(pc);

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    return pc;
  }, [attachRemoteStream, setPcListeners]);

  const ensureLocalMedia = useCallback(async () => {
    if (localStreamRef.current) {
      return localStreamRef.current;
    }
    const stream = await navigator.mediaDevices.getUserMedia(MEDIA_CONSTRAINTS);
    localStreamRef.current = stream;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
    }
    setMediaReady(true);
    return stream;
  }, []);

  const flushPendingCandidates = useCallback(async (pc) => {
    if (!remoteDescriptionSetRef.current) {
      return;
    }
    const queue = [...pendingCandidatesRef.current];
    pendingCandidatesRef.current = [];
    for (const candidate of queue) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (e) {
        console.error("Failed to add queued ICE candidate:", e);
      }
    }
  }, []);

  const preparePeer = useCallback(async () => {
    await ensureLocalMedia();
    if (!pcRef.current || pcRef.current.signalingState === "closed") {
      buildPeerConnection();
    }
  }, [buildPeerConnection, ensureLocalMedia]);

  const createAndSendOffer = useCallback(
    async (iceRestart = false) => {
      await preparePeer();
      const pc = pcRef.current;
      const offer = await pc.createOffer({ iceRestart });
      await pc.setLocalDescription(offer);
      await publishSignal("offer", pc.localDescription.toJSON());
    },
    [preparePeer, publishSignal],
  );

  const handleOffer = useCallback(
    async (offer) => {
      await preparePeer();
      const pc = pcRef.current;

      if (pc.signalingState !== "stable") {
        try {
          await pc.setLocalDescription({ type: "rollback" });
        } catch (_) {
          // Some browsers do not allow rollback in every state.
        }
      }

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      remoteDescriptionSetRef.current = true;
      await flushPendingCandidates(pc);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await publishSignal("answer", pc.localDescription.toJSON());
      setInCall(true);
    },
    [flushPendingCandidates, preparePeer, publishSignal],
  );

  const handleAnswer = useCallback(
    async (answer) => {
      const pc = pcRef.current;
      if (!pc || pc.signalingState === "closed") {
        return;
      }
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      remoteDescriptionSetRef.current = true;
      await flushPendingCandidates(pc);
      setInCall(true);
    },
    [flushPendingCandidates],
  );

  const handleCandidate = useCallback(async (candidate) => {
    const iceCandidate = new RTCIceCandidate(candidate);
    const pc = pcRef.current;
    if (!pc || pc.signalingState === "closed") {
      return;
    }
    if (!remoteDescriptionSetRef.current) {
      pendingCandidatesRef.current.push(iceCandidate);
      return;
    }
    try {
      await pc.addIceCandidate(iceCandidate);
    } catch (e) {
      console.error("Failed to add ICE candidate:", e);
    }
  }, []);

  const handleSignal = useCallback(
    async (signal) => {
      try {
        if (signal.type === "offer") {
          await handleOffer(signal.payload);
        } else if (signal.type === "answer") {
          await handleAnswer(signal.payload);
        } else if (signal.type === "candidate") {
          await handleCandidate(signal.payload);
        }
      } catch (e) {
        setError(e?.message || "Failed to process signal.");
      }
    },
    [handleAnswer, handleCandidate, handleOffer],
  );

  const stopAllMedia = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach((track) => track.stop());
      remoteStreamRef.current = null;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    setMediaReady(false);
  }, []);

  const closePc = useCallback(() => {
    const pc = pcRef.current;
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      pc.close();
      pcRef.current = null;
    }
  }, []);

  const endCall = useCallback(() => {
    closePc();
    stopAllMedia();
    setInCall(false);
    setIsMuted(false);
    setIsCameraOff(false);
    setConnectionState("closed");
    remoteDescriptionSetRef.current = false;
    pendingCandidatesRef.current = [];
  }, [closePc, stopAllMedia]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) {
      return;
    }
    const nextMuted = !isMuted;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setIsMuted(nextMuted);
  }, [isMuted]);

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) {
      return;
    }
    const nextCameraOff = !isCameraOff;
    stream.getVideoTracks().forEach((track) => {
      track.enabled = !nextCameraOff;
    });
    setIsCameraOff(nextCameraOff);
  }, [isCameraOff]);

  const getLocalStream = useCallback(() => localStreamRef.current, []);

  const attemptReconnect = useCallback(async () => {
    if (reconnectLockRef.current || !isMountedRef.current) {
      return;
    }
    reconnectLockRef.current = true;

    try {
      const pc = pcRef.current;
      if (!pc || pc.signalingState === "closed") {
        await preparePeer();
        await createAndSendOffer(true);
        reconnectLockRef.current = false;
        return;
      }

      if (typeof pc.restartIce === "function") {
        pc.restartIce();
      }
      await createAndSendOffer(true);

      setTimeout(async () => {
        try {
          const current = pcRef.current;
          if (!current || current.connectionState === "connected") {
            return;
          }
          closePc();
          await preparePeer();
          await createAndSendOffer(true);
        } catch (e) {
          setError(e?.message || "Reconnect retry failed.");
        } finally {
          reconnectLockRef.current = false;
        }
      }, 5000);
    } catch (e) {
      setError(e?.message || "Reconnect failed.");
      reconnectLockRef.current = false;
    }
  }, [closePc, createAndSendOffer, preparePeer]);

  useEffect(() => {
    attemptReconnectRef.current = attemptReconnect;
  }, [attemptReconnect]);

  useEffect(() => {
    isMountedRef.current = true;
    const handleOnline = () => {
      void attemptReconnect();
    };
    window.addEventListener("online", handleOnline);
    return () => {
      isMountedRef.current = false;
      window.removeEventListener("online", handleOnline);
    };
  }, [attemptReconnect]);

  useEffect(() => {
    if (!enabled) {
      endCall();
      return undefined;
    }

    void ensureLocalMedia().catch((e) => {
      setError(e?.message || "Camera/microphone permission failed.");
    });

    return () => {
      endCall();
    };
  }, [enabled, endCall, ensureLocalMedia]);

  return {
    localVideoRef,
    remoteVideoRef,
    mediaReady,
    inCall,
    connectionState,
    isMuted,
    isCameraOff,
    error,
    preparePeer,
    createAndSendOffer,
    handleSignal,
    endCall,
    attemptReconnect,
    toggleMute,
    toggleCamera,
    getLocalStream,
  };
}
