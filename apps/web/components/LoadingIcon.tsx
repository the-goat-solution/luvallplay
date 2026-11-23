export function LoadingIcon({
  size = "md",
  className,
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <span
      className={`loading-icon loading-icon-${size}${className ? ` ${className}` : ""}`}
      role="status"
      aria-label="Loading"
    >
      <img src="/uploads/three-wolves-logo-white-mini.png" alt="" />
    </span>
  );
}
