import { SubmitButton } from "../submit-button";
import { fieldClass } from "../ui";

export function ClubSpellingsForm({
  clubKey,
  canonical,
  aliases,
  action,
}: {
  clubKey: string;
  canonical: string;
  aliases: readonly string[];
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <form action={action} className="flex flex-wrap items-end gap-2" key={clubKey}>
      <input name="name" type="hidden" value={canonical} />
      {[1, 2, 3].map((slot) => (
        <label className="text-xs font-medium text-zinc-500" key={`${clubKey}:${slot}`}>
          Spelling {slot}
          <input
            className={`${fieldClass} mt-1 w-full max-w-xs sm:w-44`}
            defaultValue={aliases[slot - 1] ?? ""}
            name={`alias_${slot}`}
          />
        </label>
      ))}
      <SubmitButton pendingLabel="Saving…" variant="primary">
        Save spellings
      </SubmitButton>
    </form>
  );
}
