// The id other people see for a social profile (social_profiles.public_id):
// 12 letters and digits, random. It says nothing about the account behind it
// and can't be counted through, unlike players.id, which is never shown.
import { randomInt } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const LENGTH = 12;

/** A new public id: 62^12 possibilities, each character drawn evenly. The table's unique key settles a clash. */
export function newPublicId(): string {
  let id = "";
  for (let i = 0; i < LENGTH; i++) id += ALPHABET[randomInt(ALPHABET.length)];
  return id;
}

/** Whether this is the shape of a public id. Anything else is never sent to the database. */
export function isPublicId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9A-Za-z]{12}$/.test(value);
}
