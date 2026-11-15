"use client";

import { useFormStatus } from "react-dom";

/**
 * A submit button that says so while its form's Server Action is running.
 * Building a plan takes a couple of minutes; a button that sits there looking
 * unpressed for that long gets pressed again.
 */
export function SubmitButton({
  children,
  pendingLabel,
  disabled = false,
  className,
}: {
  children: React.ReactNode;
  pendingLabel: string;
  disabled?: boolean;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={disabled || pending} aria-busy={pending} className={className}>
      {pending ? pendingLabel : children}
    </button>
  );
}
