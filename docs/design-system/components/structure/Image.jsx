import React from "react";

const RADIUS = {
  none: "0",
  sm: "var(--r-sm)",
  md: "var(--r-md)",
  lg: "var(--r-lg)",
  xl: "var(--r-xl)",
  full: "var(--r-full)",
};

/**
 * Image — the system's single image primitive. Wraps user content (generated
 * frames, thumbnails, avatars) in a neutral dark frame: flat --surface fill,
 * 1px --border, --r-lg radius by default, object-fit cover.
 *
 * Before the image loads (and if it errors) the frame shows the DS's one
 * sanctioned placeholder: a 45° --surface-3 / --stripe diagonal hatch with a
 * small mono label — never a spinner-less blank, never a decorative gradient.
 * Set `ratio` (e.g. "9/16", "1/1", "16/9") to lock the box before load so the
 * layout doesn't jump. Presentational; pass a real `alt` for meaningful images.
 */
export function Image({
  src,
  alt = "",
  ratio,
  radius = "lg",
  fit = "cover",
  bordered = true,
  placeholder = "imagen",
  style,
  ...props
}) {
  const [status, setStatus] = React.useState(src ? "loading" : "empty");

  React.useEffect(() => {
    setStatus(src ? "loading" : "empty");
  }, [src]);

  const r = RADIUS[radius] ?? RADIUS.lg;
  const showPlaceholder = status !== "loaded";

  return (
    <div
      style={{
        position: "relative",
        aspectRatio: ratio || undefined,
        borderRadius: r,
        overflow: "hidden",
        background:
          "repeating-linear-gradient(135deg, var(--surface-3) 0 10px, var(--stripe) 10px 20px)",
        border: bordered ? "1px solid var(--border)" : "none",
        ...style,
      }}
      {...props}
    >
      {src && status !== "error" && (
        <img
          src={src}
          alt={alt}
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("error")}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: fit,
            display: "block",
            opacity: status === "loaded" ? 1 : 0,
            transition: "opacity .2s",
          }}
        />
      )}
      {showPlaceholder && (
        <span
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            color: status === "error" ? "var(--danger)" : "var(--text-3)",
            pointerEvents: "none",
          }}
        >
          {status === "error" ? "⚠ no disponible" : placeholder}
        </span>
      )}
    </div>
  );
}
