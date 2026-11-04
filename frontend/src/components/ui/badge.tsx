import * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?:
    | "default"
    | "secondary"
    | "outline"
    | "destructive"
    | "warning"
    | "success"
    | "location";
}

export function Badge({
  className,
  variant = "default",
  ...props
}: BadgeProps) {
  const variants: Record<NonNullable<BadgeProps["variant"]>, string> = {
    default: "bg-primary/15 text-primary border-primary/30",
    secondary: "bg-secondary text-secondary-foreground border-border",
    outline: "text-foreground border-border bg-card",
    destructive: "bg-destructive/15 text-destructive border-destructive/40",
    warning: "bg-warning/15 text-warning border-warning/40",
    success: "bg-success/15 text-success border-success/40",
    location:
      "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold transition-colors",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}

