import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Merges Tailwind classes safely, resolving conflicts via tailwind-merge.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
