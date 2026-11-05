"use client";

import { useFormStatus } from "react-dom";
import { buttonClass } from "./ui";

export function SubmitButton({
  children,
  pendingLabel,
  variant = "secondary",
  name,
  value,
}: {
  children: string;
  pendingLabel: string;
  variant?: "primary" | "secondary" | "ghost";
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={buttonClass(variant)} disabled={pending} name={name} type="submit" value={value}>
      {pending ? pendingLabel : children}
    </button>
  );
}
