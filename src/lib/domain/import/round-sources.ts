/** Forum threads for tours 1–11. These URLs are the intended source list. */
export const ROUND_SOURCES = [
  { number: 1, name: "1 тур", url: "https://canadaru.net/udaff_afterlife/sport/football/rpl/1095/" },
  { number: 2, name: "2 тур", url: "https://canadaru.net/udaff_afterlife/sport/football/rpl/1205/" },
  { number: 3, name: "3 тур", url: "https://canadaru.net/udaff_afterlife/sport/football/rpl/1288/" },
  { number: 4, name: "4 тур", url: "https://canadaru.net/udaff_afterlife/sport/football/rpl/1522/" },
  { number: 5, name: "5 тур", url: "https://canadaru.net/udaff_afterlife/sport/football/rpl/1717/" },
  { number: 6, name: "6 тур", url: "https://canadaru.net/udaff_afterlife/sport/football/rpl/1827/" },
  { number: 7, name: "7 тур", url: "https://canadaru.net/udaff_afterlife/sport/football/rpl/1887/" },
  { number: 8, name: "8 тур", url: "https://canadaru.net/udaff_afterlife/sport/football/rpl/1990/" },
  { number: 9, name: "9 тур", url: "https://canadaru.net/udaff_afterlife/sport/football/rpl/2067/" },
  { number: 10, name: "10 тур", url: "https://canadaru.net/udaff_afterlife/sport/football/rpl/2554/" },
  { number: 11, name: "11 тур", url: "https://canadaru.net/udaff_afterlife/sport/football/rpl/2633/" },
] as const;

export interface RoundSource {
  number: number;
  name: string;
  url: string;
}
