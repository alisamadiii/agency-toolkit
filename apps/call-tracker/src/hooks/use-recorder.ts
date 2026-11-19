import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderState = "idle" | "ready" | "recording" | "stopped";

function pickMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

// Document Picture-in-Picture isn't in lib.dom yet.
interface DocumentPiP {
  requestWindow: (opts?: {
    width?: number;
    height?: number;
  }) => Promise<Window>;
  window: Window | null;
}
function getDocumentPiP(): DocumentPiP | null {
  return (
    (window as unknown as { documentPictureInPicture?: DocumentPiP })
      .documentPictureInPicture ?? null
  );
}

export function useRecorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [pipActive, setPipActive] = useState(false);

  // Webcam (preview + mic). Screen (what we record). Mixed output stream.
  const camStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pipWindowRef = useRef<Window | null>(null);

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const closePiP = useCallback(() => {
    try {
      pipWindowRef.current?.close();
    } catch {
      /* already closed */
    }
    pipWindowRef.current = null;
    if (document.pictureInPictureElement) {
      void document.exitPictureInPicture().catch(() => {});
    }
    setPipActive(false);
  }, []);

  const releaseStreams = useCallback(() => {
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    camStreamRef.current?.getTracks().forEach((t) => t.stop());
    camStreamRef.current = null;
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }, []);

  const open = useCallback(async () => {
    setError(null);
    setBlob(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280 },
        audio: true,
      });
      camStreamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setState("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Camera unavailable");
      setState("idle");
    }
  }, []);

  // Build one audio track from the mic plus any screen/tab audio.
  const buildAudioTrack = (screen: MediaStream): MediaStreamTrack | null => {
    const micTrack = camStreamRef.current?.getAudioTracks()[0] ?? null;
    const screenAudio = screen.getAudioTracks()[0] ?? null;
    if (micTrack && screenAudio) {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const dest = ctx.createMediaStreamDestination();
      ctx.createMediaStreamSource(new MediaStream([micTrack])).connect(dest);
      ctx.createMediaStreamSource(new MediaStream([screenAudio])).connect(dest);
      return dest.stream.getAudioTracks()[0] ?? micTrack;
    }
    return micTrack ?? screenAudio;
  };

  const start = useCallback(async () => {
    if (!camStreamRef.current) return;
    setError(null);
    setBlob(null);
    let screen: MediaStream;
    try {
      screen = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
    } catch (err) {
      // User dismissed the picker, or capture denied — stay on preview.
      if (err instanceof Error && err.name !== "NotAllowedError") {
        setError(err.message);
      }
      return;
    }
    screenStreamRef.current = screen;

    const screenVideo = screen.getVideoTracks()[0];
    if (!screenVideo) {
      setError("No screen video track");
      return;
    }
    // Stopping from Chrome's native "Stop sharing" bar must finalize the clip.
    screenVideo.addEventListener("ended", () => {
      stopTimer();
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
    });

    const audioTrack = buildAudioTrack(screen);
    const recordStream = new MediaStream(
      audioTrack ? [screenVideo, audioTrack] : [screenVideo]
    );

    chunksRef.current = [];
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(
      recordStream,
      mimeType ? { mimeType } : undefined
    );
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      setBlob(
        new Blob(chunksRef.current, { type: recorder.mimeType || "video/webm" })
      );
      setState("stopped");
      // The shared screen is done once recording ends.
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    };
    recorder.start(1000); // timeslice so a crash mid-call keeps data
    recorderRef.current = recorder;
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    setState("recording");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = useCallback(() => {
    stopTimer();
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }, []);

  // Float the webcam over every app so the whole-screen recording captures it.
  // A fresh <video> is created inside the PiP window bound to the same stream,
  // so React keeps full ownership of the in-page preview node.
  const popOutCamera = useCallback(async () => {
    const cam = camStreamRef.current;
    if (!cam) return;
    const docPiP = getDocumentPiP();
    try {
      if (docPiP) {
        const pip = await docPiP.requestWindow({ width: 320, height: 240 });
        pipWindowRef.current = pip;
        pip.document.body.style.cssText = "margin:0;background:#000";
        const v = pip.document.createElement("video");
        v.autoplay = true;
        v.muted = true;
        v.playsInline = true;
        v.srcObject = cam;
        v.style.cssText = "width:100%;height:100%;object-fit:cover";
        pip.document.body.append(v);
        pip.addEventListener("pagehide", () => {
          pipWindowRef.current = null;
          setPipActive(false);
        });
        setPipActive(true);
      } else if (videoRef.current?.requestPictureInPicture) {
        await videoRef.current.requestPictureInPicture();
        setPipActive(true);
      } else {
        setError("Picture-in-Picture unsupported — keep this window visible.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not pop out camera");
    }
  }, []);

  const close = useCallback(() => {
    stopTimer();
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    closePiP();
    releaseStreams();
    setState("idle");
    setBlob(null);
    setElapsed(0);
  }, [closePiP, releaseStreams]);

  // Camera light / screen share must stop when the component unmounts.
  useEffect(() => close, [close]);

  return {
    state,
    error,
    blob,
    elapsed,
    pipActive,
    videoRef,
    open,
    start,
    stop,
    close,
    popOutCamera,
    closePiP,
  };
}
