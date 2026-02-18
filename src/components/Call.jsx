import { useEffect, useRef, useState } from "react";
import { useSignaling } from "../hooks/useSignaling";
import { useWebRTC } from "../hooks/useWebRTC";
import RingingModal from "./RingingModal";

const ROOM_NAME = "main";
const UI_IDLE_MS = 3500;

export default function Call({ onLogout }) {
  const [isCaller, setIsCaller] = useState(false);
  const [showRingingModal, setShowRingingModal] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [uiVisible, setUiVisible] = useState(true);
  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.matchMedia("(max-width: 859px)").matches;
  });
  const [isDraggingPip, setIsDraggingPip] = useState(false);
  const [pipPosition, setPipPosition] = useState(null);
  const [localAspectRatio, setLocalAspectRatio] = useState("16 / 9");
  const offerSentForAcceptedRef = useRef(false);
  const isCallerRef = useRef(false);
  const ringtoneTimerRef = useRef(null);
  const audioContextRef = useRef(null);
  const stageRef = useRef(null);
  const localPipRef = useRef(null);
  const pipLocalVideoRef = useRef(null);
  const pipCanvasRef = useRef(null);
  const pipAnimationRef = useRef(null);
  const hideTimerRef = useRef(null);
  const uiVisibleRef = useRef(true);
  const dragRef = useRef(null);

  const {
    ready,
    roomFull,
    participantCount,
    callStatus,
    callStatusSender,
    userId,
    registerSignalHandler,
    publishSignal,
    clearSignals,
    resetCallState,
    updateCallStatus,
  } = useSignaling(ROOM_NAME, true);

  const {
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
    toggleMute,
    toggleCamera,
    getLocalStream,
  } = useWebRTC({
    enabled: ready && !roomFull,
    publishSignal,
    clearSignals,
  });

  useEffect(() => {
    registerSignalHandler((signal) => {
      void handleSignal(signal);
    });
  }, [handleSignal, registerSignalHandler]);

  useEffect(() => {
    const bindVideoAspect = (videoEl, setRatio) => {
      if (!videoEl) {
        return () => {};
      }
      const syncRatio = () => {
        if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
          setRatio(`${videoEl.videoWidth} / ${videoEl.videoHeight}`);
        }
      };

      syncRatio();
      videoEl.addEventListener("loadedmetadata", syncRatio);
      videoEl.addEventListener("resize", syncRatio);

      return () => {
        videoEl.removeEventListener("loadedmetadata", syncRatio);
        videoEl.removeEventListener("resize", syncRatio);
      };
    };

    const unbindLocal = bindVideoAspect(localVideoRef.current, setLocalAspectRatio);
    return () => {
      unbindLocal();
    };
  }, [localVideoRef, mediaReady, inCall]);

  useEffect(() => {
    const pipVideoEl = pipLocalVideoRef.current;
    const localStream = getLocalStream();
    const canvas = pipCanvasRef.current;
    if (!pipVideoEl || !localStream || !canvas) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const localVideoEl = localVideoRef.current;
    const remoteVideoEl = remoteVideoRef.current;
    canvas.width = 720;
    canvas.height = 405;

    const render = () => {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const halfW = canvas.width / 2;
      const h = canvas.height;

      if (remoteVideoEl && remoteVideoEl.videoWidth > 0 && remoteVideoEl.videoHeight > 0) {
        ctx.drawImage(remoteVideoEl, 0, 0, halfW, h);
      } else {
        ctx.fillStyle = "#111";
        ctx.fillRect(0, 0, halfW, h);
      }

      if (localVideoEl && localVideoEl.videoWidth > 0 && localVideoEl.videoHeight > 0) {
        ctx.save();
        // Keep self-preview mirrored in composite.
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(localVideoEl, 0, 0, halfW, h);
        ctx.restore();
      } else {
        ctx.fillStyle = "#111";
        ctx.fillRect(halfW, 0, halfW, h);
      }

      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillRect(halfW - 1, 0, 2, h);

      pipAnimationRef.current = requestAnimationFrame(render);
    };

    render();

    const canvasStream =
      typeof canvas.captureStream === "function" ? canvas.captureStream(15) : null;
    if (canvasStream) {
      pipVideoEl.srcObject = canvasStream;
    } else {
      // Fallback to local-only stream if canvas stream is unavailable.
      pipVideoEl.srcObject = new MediaStream(localStream.getVideoTracks());
    }

    pipVideoEl.muted = true;
    pipVideoEl.playsInline = true;
    void pipVideoEl.play().catch(() => {});

    return () => {
      if (pipAnimationRef.current) {
        cancelAnimationFrame(pipAnimationRef.current);
        pipAnimationRef.current = null;
      }
      pipVideoEl.srcObject = null;
    };
  }, [getLocalStream, inCall, localVideoRef, remoteVideoRef]);

  const stopRingtone = () => {
    if (ringtoneTimerRef.current) {
      clearInterval(ringtoneTimerRef.current);
      ringtoneTimerRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
  };

  const playRingtone = () => {
    if (audioContextRef.current || ringtoneTimerRef.current) {
      return;
    }
    const ctx = new AudioContext();
    audioContextRef.current = ctx;

    const ring = () => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 720;
      gain.gain.value = 0.02;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      setTimeout(() => osc.stop(), 350);
    };

    ring();
    ringtoneTimerRef.current = setInterval(ring, 900);
  };

  useEffect(() => {
    if (
      callStatus === "ringing" &&
      !isCallerRef.current &&
      callStatusSender !== userId &&
      !inCall
    ) {
      setShowRingingModal(true);
      playRingtone();
      offerSentForAcceptedRef.current = false;
    }

    if (callStatus === "accepted") {
      stopRingtone();
      setShowRingingModal(false);
      if (isCaller && !offerSentForAcceptedRef.current) {
        offerSentForAcceptedRef.current = true;
        void createAndSendOffer(false);
      }
    }

    if (callStatus === "declined") {
      stopRingtone();
      setShowRingingModal(false);
      setIsCaller(false);
      isCallerRef.current = false;
      offerSentForAcceptedRef.current = false;
    }

    if (callStatus === "ended") {
      stopRingtone();
      setShowRingingModal(false);
      setIsCaller(false);
      isCallerRef.current = false;
      offerSentForAcceptedRef.current = false;
      endCall();
    }
  }, [callStatus, callStatusSender, createAndSendOffer, endCall, inCall, userId]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 859px)");
    const apply = () => setIsMobileViewport(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => {
      mq.removeEventListener("change", apply);
    };
  }, []);

  useEffect(() => {
    const enterPipForVideo = async (videoEl) => {
      if (!videoEl) {
        return false;
      }

      if (typeof videoEl.play === "function") {
        try {
          await videoEl.play();
        } catch (_) {
          // Some browsers block play without gesture; continue to PiP attempts.
        }
      }

      // Standard PiP API (Chrome/Edge/Android/Safari where supported).
      if (typeof videoEl.requestPictureInPicture === "function") {
        try {
          await videoEl.requestPictureInPicture();
          return true;
        } catch (_) {
          // Continue to WebKit fallback.
        }
      }

      // iOS/iPadOS Safari fallback.
      if (
        typeof videoEl.webkitSetPresentationMode === "function" &&
        videoEl.webkitSupportsPresentationMode?.("picture-in-picture")
      ) {
        try {
          videoEl.webkitSetPresentationMode("picture-in-picture");
          return true;
        } catch (_) {
          // Ignore if browser blocks this transition.
        }
      }

      return false;
    };

    const requestMobilePip = async () => {
      if (!inCall || !document.fullscreenElement) {
        return;
      }

      if (document.pictureInPictureElement) {
        return;
      }

      // Include own camera in PiP preference for mobile experience.
      const pipLocalVideoEl = pipLocalVideoRef.current;
      const localVideoEl = localVideoRef.current;
      const remoteVideoEl = remoteVideoRef.current;
      const candidates = isCameraOff
        ? [remoteVideoEl, pipLocalVideoEl, localVideoEl]
        : [pipLocalVideoEl, localVideoEl, remoteVideoEl];

      for (const candidate of candidates) {
        // Stop after first successful PiP transition.
        // eslint-disable-next-line no-await-in-loop
        const ok = await enterPipForVideo(candidate);
        if (ok) {
          break;
        }
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        void requestMobilePip();
      }
    };

    const handlePageHide = () => {
      void requestMobilePip();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [inCall, isCameraOff, localVideoRef, remoteVideoRef]);

  useEffect(() => {
    return () => {
      stopRingtone();
    };
  }, []);

  const handleCall = async () => {
    isCallerRef.current = true;
    setIsCaller(true);
    offerSentForAcceptedRef.current = false;
    setShowRingingModal(false);
    stopRingtone();
    await resetCallState();
    await preparePeer();
    await updateCallStatus("ringing");
  };

  const handleAccept = async () => {
    isCallerRef.current = false;
    setIsCaller(false);
    stopRingtone();
    setShowRingingModal(false);
    await preparePeer();
    await updateCallStatus("accepted");
  };

  const handleDecline = async () => {
    stopRingtone();
    setShowRingingModal(false);
    setIsCaller(false);
    isCallerRef.current = false;
    await updateCallStatus("declined");
  };

  const handleEnd = async () => {
    endCall();
    setIsCaller(false);
    isCallerRef.current = false;
    offerSentForAcceptedRef.current = false;
    await clearSignals();
    await updateCallStatus("ended");
  };

  const canCall = participantCount >= 2 && mediaReady && callStatus !== "ringing";
  const canEnd = inCall || callStatus === "ringing";

  const connectionLabel =
    connectionState === "connected"
      ? "Live"
      : connectionState === "connecting"
        ? "Connecting"
        : connectionState === "disconnected"
          ? "Reconnecting"
          : connectionState;

  const callLabel =
    callStatus === "ringing"
      ? "Ringing"
      : callStatus === "accepted"
        ? "In Call"
        : callStatus === "declined"
          ? "Declined"
          : callStatus === "ended"
            ? "Ended"
            : "Ready";

  const setVisibleState = (value) => {
    if (uiVisibleRef.current === value) {
      return;
    }
    uiVisibleRef.current = value;
    setUiVisible(value);
  };

  const resetUiTimer = () => {
    setVisibleState(true);
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = setTimeout(() => {
      if (!showRingingModal) {
        setVisibleState(false);
      }
    }, UI_IDLE_MS);
  };

  useEffect(() => {
    resetUiTimer();
    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, [showRingingModal]);

  useEffect(() => {
    // Desktop keeps anchored behavior; mobile keeps dragged position permanently.
    if (!isMobileViewport) {
      setPipPosition(null);
    }
  }, [isMobileViewport, uiVisible]);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await stageRef.current?.requestFullscreen?.();
      } else {
        await document.exitFullscreen?.();
      }
    } catch (_) {
      // Ignore fullscreen permission errors.
    }
  };

  const handleLogout = async () => {
    stopRingtone();
    endCall();
    await updateCallStatus("ended");
    onLogout?.();
  };

  const clampPipPosition = (x, y) => {
    const stageEl = stageRef.current;
    const pipEl = localPipRef.current;
    if (!stageEl || !pipEl) {
      return { x, y };
    }

    const margin = 8;
    const stageRect = stageEl.getBoundingClientRect();
    const pipRect = pipEl.getBoundingClientRect();
    const maxX = Math.max(margin, stageRect.width - pipRect.width - margin);
    const maxY = Math.max(margin, stageRect.height - pipRect.height - margin);

    return {
      x: Math.min(Math.max(margin, x), maxX),
      y: Math.min(Math.max(margin, y), maxY),
    };
  };

  const startPipDrag = (event) => {
    const stageEl = stageRef.current;
    const pipEl = localPipRef.current;
    if (!stageEl || !pipEl) {
      return;
    }

    const stageRect = stageEl.getBoundingClientRect();
    const pipRect = pipEl.getBoundingClientRect();
    const currentX = pipPosition?.x ?? pipRect.left - stageRect.left;
    const currentY = pipPosition?.y ?? pipRect.top - stageRect.top;

    setPipPosition({ x: currentX, y: currentY });
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - (stageRect.left + currentX),
      offsetY: event.clientY - (stageRect.top + currentY),
    };
    setIsDraggingPip(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  useEffect(() => {
    const onPointerMove = (event) => {
      const drag = dragRef.current;
      const stageEl = stageRef.current;
      if (!drag || !stageEl) {
        return;
      }

      const stageRect = stageEl.getBoundingClientRect();
      const nextX = event.clientX - stageRect.left - drag.offsetX;
      const nextY = event.clientY - stageRect.top - drag.offsetY;
      setPipPosition(clampPipPosition(nextX, nextY));
    };

    const onPointerUp = () => {
      if (!dragRef.current) {
        return;
      }
      dragRef.current = null;
      setIsDraggingPip(false);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, []);

  useEffect(() => {
    const onResize = () => {
      if (!pipPosition) {
        return;
      }
      setPipPosition((prev) => {
        if (!prev) {
          return prev;
        }
        return clampPipPosition(prev.x, prev.y);
      });
    };

    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [pipPosition]);

  if (roomFull) {
    return (
      <div className="auth-shell">
        <div className="card room-full-card">
          <h2>Room Full</h2>
          <p>Only 2 users are allowed in this private room.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`call-stage mobile-dashboard ${uiVisible ? "" : "ui-hidden"}`}
      ref={stageRef}
      tabIndex={0}
      onMouseMove={resetUiTimer}
      onTouchStart={resetUiTimer}
      onClick={resetUiTimer}
      onKeyDown={resetUiTimer}
    >
      <RingingModal
        open={showRingingModal}
        onAccept={handleAccept}
        onDecline={handleDecline}
      />
      <canvas ref={pipCanvasRef} className="pip-canvas-source" />
      <video
        ref={pipLocalVideoRef}
        className="pip-local-source"
        autoPlay
        muted
        playsInline
      />
      <div className="remote-video-shell">
        <video className="remote-video" ref={remoteVideoRef} autoPlay playsInline />
      </div>
      <div className="stage-shade" />
      <header className="stage-header overlay-ui">
        <div className="stage-title overlay-ui">
          <h1>Private Room</h1>
          <p>1-on-1 Dashboard</p>
        </div>
        <div className="header-actions">
          <button type="button" className="ghost-btn" onClick={toggleFullscreen}>
            {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          </button>
          <button type="button" className="ghost-btn logout-btn" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      <section className="dashboard-strip overlay-ui">
        <article className="glass-card">
          <span>Participants</span>
          <strong>{participantCount}/2</strong>
        </article>
        <article className="glass-card">
          <span>Connection</span>
          <strong>{connectionLabel}</strong>
        </article>
        <article className="glass-card">
          <span>Call</span>
          <strong>{callLabel}</strong>
        </article>
      </section>

      <aside
        ref={localPipRef}
        className={`local-pip ${!uiVisible ? "docked" : ""} ${pipPosition ? "is-custom-pos" : ""} ${isDraggingPip ? "dragging" : ""} ${isCameraOff ? "camera-off" : ""}`}
        style={{
          aspectRatio: localAspectRatio,
          left: pipPosition?.x,
          top: pipPosition?.y,
        }}
        onPointerDown={startPipDrag}
      >
        <video ref={localVideoRef} autoPlay muted playsInline />
        {isCameraOff ? <span>Camera Off</span> : null}
      </aside>

      <section className="stage-controls overlay-ui">
        <button
          onClick={handleCall}
          type="button"
          disabled={!canCall}
        >
          Call
        </button>
        <button
          type="button"
          className={isMuted ? "btn-warning" : ""}
          onClick={toggleMute}
          disabled={!mediaReady}
        >
          {isMuted ? "Unmute" : "Mute"}
        </button>
        <button
          type="button"
          className={isCameraOff ? "btn-warning" : ""}
          onClick={toggleCamera}
          disabled={!mediaReady}
        >
          {isCameraOff ? "Turn Camera On" : "Turn Camera Off"}
        </button>
        <button
          className="btn-danger"
          onClick={handleEnd}
          type="button"
          disabled={!canEnd}
        >
          End Call
        </button>
      </section>

      {!canCall ? (
        <div className="stage-hint overlay-ui">
          {participantCount < 2
            ? "Waiting for second participant..."
            : !mediaReady
              ? "Allow camera/microphone to start."
              : "Call already ringing."}
        </div>
      ) : null}

      {error ? <div className="stage-error overlay-ui">{error}</div> : null}
    </div>
  );
}
