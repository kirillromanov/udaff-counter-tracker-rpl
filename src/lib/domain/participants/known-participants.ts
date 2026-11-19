/** Display names for the current contest. Stored exactly, including punctuation. */
export const KNOWN_PARTICIPANTS = [
  "Hordi Cruyff",
  "зукабля",
  "neofit",
  "Камидиант",
  "Filka",
  "Мычман",
  "XXX",
  "Askvit",
  "Doctor Livesey",
  "БалБес",
  "моноклон",
  "Йош!",
  "Chiger",
  "карагоз",
  "ослопЁс",
  "hrenSbugra",
  "Vinnie Jones",
  "Павел Абросимов",
  "Schmelzer",
  "pitchezz",
  "Ли Харви Освальд",
  "Пиночет",
  "СашкоБубен",
  "Лысая_ Башка",
  "nikatin",
] as const;

/**
 * Forum spellings that are the same person as a registry name.
 * The normalized keys stay different. The alias row is what links them.
 */
export const KNOWN_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "Лысая_ Башка": ["Лысая_Башка"],
  моноклон: ["monoklon"],
  зукабля: ["Zukoblya"],
  "Vinnie Jones": ["Vinnie_Jones"],
  "Павел Абросимов": ["Павел"],
};

/** Forum accounts that comment in the threads and do not enter the contest. */
export const KNOWN_IGNORED_AUTHORS = ["LAX", "Rotvalez"] as const;
