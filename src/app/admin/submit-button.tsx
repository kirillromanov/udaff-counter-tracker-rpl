"use client";

import { useFormStatus } from "react-dom";
import { buttonClass } from "./ui";

export function SubmitButton({
  children,
  pendingLabel,
  variant = "secondary",
}: {
  children: string;
  pendingLabel: string;
  variant?: "primary" | "secondary" | "ghost";
}) {
  const { pending } = useFormStatus();
  return (
    <button className={buttonClass(variant)} disabled={pending} type="submit">
      {pending ? pendingLabel : children}
    </button>
  );
}
