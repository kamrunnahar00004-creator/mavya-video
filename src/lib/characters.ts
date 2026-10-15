/**
 * Built-in characters: synthetic people we generated (scripts/characters.py, scripts/cast_more.py; prompts in
 * docs/CHARACTER_PROMPTS.md). Images live in public/characters/<id>.jpg (+ thumbs/). Only first names are shown to users.
 * Order mixes looks and backgrounds so the grid never opens with one type.
 */
export const CHARACTERS = [
  "olivia", "zuri", "mei", "jake", "ella", "diya", "sienna", "simone", "yuna", "liam",
  "ava", "amara", "isla", "hana", "marcus", "mia", "riya", "jada", "freya", "minho",
  "ruby", "priya", "sora", "nora", "imani", "noah", "harper", "tiana", "mina", "emma",
  "kenji", "bella", "nala", "isha", "maddie", "aiko", "andre", "eva", "jordan", "clara",
  "tala", "chloe", "owen", "quinn", "nia", "leah", "jiwoo", "arjun", "sophie", "ananya",
  "grace", "lily", "malik", "hannah", "linh", "zoe", "ethan", "kate", "kayla", "jun",
  "josie", "xiao", "tess", "ayo", "max", "molly", "meera", "kim", "ryan", "piper",
].map((id) => ({ id, name: id[0].toUpperCase() + id.slice(1), src: `/characters/${id}.jpg`, thumb: `/characters/thumbs/${id}.jpg` }));

export const characterById = (id: string | undefined) => CHARACTERS.find((c) => c.id === id) ?? null;
