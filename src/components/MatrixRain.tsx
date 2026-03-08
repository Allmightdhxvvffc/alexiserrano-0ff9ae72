import { useEffect, useRef } from "react";

const MatrixRain = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const chars = "01アイウエオカキクケコサシスセソ";
    const fontSize = 14;
    // Limit columns on low-end Chromebooks for performance
    const maxCols = Math.min(Math.floor(canvas.width / fontSize), 120);
    const drops = Array(maxCols).fill(1);

    const draw = () => {
      ctx.fillStyle = "rgba(8, 12, 18, 0.05)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "hsl(150, 100%, 50%)";
      ctx.font = `${fontSize}px monospace`;
      ctx.globalAlpha = 0.15;

      for (let i = 0; i < drops.length; i++) {
        const text = chars[Math.floor(Math.random() * chars.length)];
        ctx.fillText(text, i * fontSize, drops[i] * fontSize);
        if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i]++;
      }
      ctx.globalAlpha = 1;
    };

    // Slower interval for Chromebook performance
    const interval = setInterval(draw, 66);
    return () => {
      clearInterval(interval);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none" />;
};

export default MatrixRain;
