import React, { useEffect, useRef, useState } from 'react';
import { FiCamera, FiRefreshCw, FiRotateCcw, FiCheck } from 'react-icons/fi';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/**
 * Takes a photo with the computer's (or phone's) camera and hands it over as a
 * JPEG file. Opens the camera directly, never the file picker.
 */
export const CameraDialog = ({ open, onOpenChange, onCapture }) => {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [facing, setFacing] = useState('user');
  const [shot, setShot] = useState(null); // { url, blob }
  const [error, setError] = useState('');
  const [canSwitch, setCanSwitch] = useState(false);

  const stop = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  useEffect(() => {
    if (!open || shot) return undefined;
    let cancelled = false;
    setError('');
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then(async (stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        const devices = await navigator.mediaDevices.enumerateDevices();
        setCanSwitch(devices.filter((d) => d.kind === 'videoinput').length > 1);
      })
      .catch(() => setError('Allow the camera in the browser, or check that no other app is using it.'));
    return () => { cancelled = true; stop(); };
  }, [open, facing, shot]);

  useEffect(() => {
    if (!open) {
      stop();
      if (shot) URL.revokeObjectURL(shot.url);
      setShot(null);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const take = () => {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const g = canvas.getContext('2d');
    if (facing === 'user') { g.translate(canvas.width, 0); g.scale(-1, 1); } // like a mirror, as on screen
    g.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      stop();
      setShot({ blob, url: URL.createObjectURL(blob) });
    }, 'image/jpeg', 0.9);
  };

  const use = () => {
    onCapture(new File([shot.blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' }));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Take photo</DialogTitle>
          <DialogDescription className="sr-only">Camera preview</DialogDescription>
        </DialogHeader>
        <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-black">
          {error ? <div className="px-6 text-center text-sm text-white/80">{error}</div>
            : shot ? <img src={shot.url} alt="Captured" className="size-full object-contain" />
              : <video ref={videoRef} autoPlay playsInline muted className="size-full object-contain" style={facing === 'user' ? { transform: 'scaleX(-1)' } : undefined} />}
        </div>
        <div className="flex items-center justify-center gap-4">
          {shot ? (
            <>
              <Button variant="outline" onClick={() => { URL.revokeObjectURL(shot.url); setShot(null); }}><FiRotateCcw /> Retake</Button>
              <Button className="bg-[#25D366] hover:bg-[#1fb857]" onClick={use}><FiCheck /> Use photo</Button>
            </>
          ) : (
            <>
              {canSwitch && <Button variant="ghost" size="icon" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} aria-label="Switch camera"><FiRefreshCw /></Button>}
              <button type="button" onClick={take} disabled={Boolean(error)} className="flex size-16 cursor-pointer items-center justify-center rounded-full border-4 border-white bg-[#25D366] text-white shadow-lg ring-2 ring-[#25D366] disabled:opacity-40" aria-label="Take photo">
                <FiCamera className="size-6" />
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
