import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Loader2,
  PictureInPicture2,
  ScreenShare,
  Square,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useInvalidateDay } from "@/hooks/use-day";
import { useRecorder } from "@/hooks/use-recorder";
import { api } from "@/lib/api";
import type { Lead } from "@shared/types";

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function CameraColumn({
  lead,
  onClose,
}: {
  lead: Lead;
  onClose: () => void;
}) {
  const recorder = useRecorder();
  const invalidate = useInvalidateDay();
  const [savedPath, setSavedPath] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: (blob: Blob) => api.uploadRecording(lead.id, blob),
    onSuccess: ({ path }) => {
      setSavedPath(path);
      invalidate();
      toast.success("Recording saved");
    },
    onError: (e) => toast.error(e.message),
  });

  // Open the camera when the selected lead changes, release it on unmount.
  const { open, close } = recorder;
  useEffect(() => {
    setSavedPath(null);
    void open();
    return close;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);

  return (
    <div className="flex h-full w-full relative rounded-4xl overflow-hidden shrink-0 flex-col bg-card">
      <div className="flex items-start absolute z-10 text-white w-full justify-between gap-2 px-4 py-3">
        <div className="min-w-0 text-shadow-2xs">
          <h2 className="truncate font-semibold">{lead.name}</h2>
          <p className="truncate text-sm opacity-80">
            {lead.phone ?? "No phone"}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>

      {/* Live camera fills the remaining height. */}
      <div className="relative min-h-0 flex-1 bg-black">
        {/* muted is mandatory — live mic playback feeds back */}
        <video
          ref={recorder.videoRef}
          muted
          autoPlay
          playsInline
          className="h-full w-full object-contain"
        />
        {recorder.state === "recording" && (
          <span className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-1 text-xs font-medium text-white">
            <span className="size-2 animate-pulse rounded-full bg-white" />
            REC {formatElapsed(recorder.elapsed)}
          </span>
        )}
        {recorder.error && (
          <p className="absolute inset-x-3 bottom-3 rounded-lg bg-destructive/90 px-3 py-2 text-sm text-white">
            {recorder.error}
          </p>
        )}
      </div>

      <div className="flex flex-col absolute bottom-0 left-0 right-0 items-center gap-2 px-4 py-3">
        {recorder.state === "ready" && (
          <Button
            onClick={() => void recorder.start()}
            className="rounded-full"
          >
            <ScreenShare className="size-4" />
            Record screen + camera
          </Button>
        )}
        {recorder.state === "recording" && (
          <div className="flex gap-2">
            <Button
              variant={recorder.pipActive ? "secondary" : "outline"}
              onClick={() => void recorder.popOutCamera()}
              className="rounded-full"
              disabled={recorder.pipActive}
            >
              <PictureInPicture2 className="size-4" />
              {recorder.pipActive ? "Camera floating" : "Float camera"}
            </Button>
            <Button
              variant="destructive"
              onClick={recorder.stop}
              className="rounded-full"
            >
              <Square className="size-4 fill-current" />
              Stop
            </Button>
          </div>
        )}
        {recorder.state === "stopped" && recorder.blob && !savedPath && (
          <>
            <Button
              onClick={() => upload.mutate(recorder.blob!)}
              disabled={upload.isPending}
              className="rounded-full"
            >
              {upload.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              Save recording
            </Button>
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => void recorder.open()}
            >
              Discard & re-open
            </Button>
          </>
        )}
        {savedPath && (
          <Button
            variant="outline"
            className="rounded-full"
            onClick={() => void recorder.open()}
          >
            Record another
          </Button>
        )}
      </div>

      {(recorder.state === "stopped" || lead.recordingPaths.length > 0) && (
        <div className="max-h-64 space-y-3 overflow-y-auto border-t px-4 py-3">
          {recorder.state === "stopped" && recorder.blob && (
            <video
              controls
              src={URL.createObjectURL(recorder.blob)}
              className="w-full rounded-xl"
            />
          )}
          {lead.recordingPaths.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">Past recordings</h4>
              {lead.recordingPaths.map((path) => (
                <div key={path} className="space-y-1">
                  <p className="truncate text-xs text-muted-foreground">
                    {path}
                  </p>
                  <video
                    controls
                    preload="metadata"
                    src={api.recordingUrl(path)}
                    className="w-full rounded-xl"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
