import {
  CalendarDays,
  CreditCard,
  LifeBuoy,
  Rocket,
  Settings,
  Sparkles,
  Ticket,
  UserRound,
  type LucideIcon,
} from "lucide-react";

import type { HelpIcon } from "@/lib/support";

export const HELP_ICON_COMPONENTS: Record<HelpIcon, LucideIcon> = {
  rocket: Rocket,
  calendar: CalendarDays,
  ticket: Ticket,
  "credit-card": CreditCard,
  user: UserRound,
  settings: Settings,
  help: LifeBuoy,
  sparkles: Sparkles,
};

export const HELP_ICON_LABELS: Record<HelpIcon, string> = {
  rocket: "Fusée",
  calendar: "Calendrier",
  ticket: "Ticket",
  "credit-card": "Carte bancaire",
  user: "Compte",
  settings: "Réglages",
  help: "Bouée",
  sparkles: "Nouveauté",
};
