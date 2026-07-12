import { useState, type JSX } from "react";

export type AvatarSize = "sm" | "md" | "lg";

export interface AvatarProps {
  name: string;
  src?: string;
  size?: AvatarSize;
  className?: string;
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0] as string).slice(0, 2).toUpperCase();
  return `${(parts[0] as string)[0]}${(parts[parts.length - 1] as string)[0]}`.toUpperCase();
}

export function Avatar({ name, src, size = "md", className }: AvatarProps): JSX.Element {
  const [imageFailed, setImageFailed] = useState(false);
  const classes = ["omni-avatar", `omni-avatar--${size}`, className].filter(Boolean).join(" ");
  const showImage = Boolean(src) && !imageFailed;

  return (
    <span className={classes} role="img" aria-label={name}>
      {showImage ? (
        <img src={src} alt="" onError={() => setImageFailed(true)} />
      ) : (
        <span aria-hidden="true">{initialsFor(name)}</span>
      )}
    </span>
  );
}
