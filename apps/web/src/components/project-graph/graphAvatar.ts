import * as Schema from "effect/Schema";

const CommitAuthors = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      author: Schema.NullOr(Schema.Struct({ id: Schema.Finite })),
      commit: Schema.Struct({ author: Schema.Struct({ email: Schema.NullOr(Schema.String) }) }),
    }),
  ),
});
const decodeCommitAuthors = Schema.decodeUnknownSync(CommitAuthors);

/** Resolve exact commit-email matches; display names are not GitHub identities. */
export function createGraphAvatarLookup(
  request: typeof fetch = (input, init) => fetch(input, init),
  now = Date.now,
) {
  const cache = new Map<string, { expires: number; value: Promise<string | null> }>();
  let requests: number[] = [];
  let blockedUntil = 0;
  return (rawEmail: string): Promise<string | null> => {
    const email = rawEmail.trim().toLowerCase();
    if (email.length > 200 || !/^[^\s"<>]+@[^\s"<>]+\.[^\s"<>]+$/u.test(email))
      return Promise.resolve(null);
    const time = now();
    const cached = cache.get(email);
    if (cached && cached.expires > time) return cached.value;
    requests = requests.filter((started) => time - started < 60_000);
    if (time < blockedUntil || requests.length >= 8) return Promise.resolve(null);
    requests.push(time);
    const params = new URLSearchParams({ q: `author-email:${email}`, per_page: "3" });
    const value = (async () => {
      try {
        const response = await request(`https://api.github.com/search/commits?${params}`, {
          headers: { Accept: "application/vnd.github+json" },
          credentials: "omit",
          referrerPolicy: "no-referrer",
          signal: AbortSignal.timeout(5_000),
        });
        if (response.status === 403 || response.status === 429) blockedUntil = now() + 60_000;
        if (!response.ok) return null;
        const result = decodeCommitAuthors(await response.json());
        const id = result.items.find(
          (item) =>
            item.commit.author.email?.trim().toLowerCase() === email &&
            item.author &&
            Number.isSafeInteger(item.author.id) &&
            item.author.id > 0,
        )?.author?.id;
        return id ? `https://avatars.githubusercontent.com/u/${id}?s=40` : null;
      } catch {
        return null;
      }
    })();
    if (cache.size >= 512) cache.delete(cache.keys().next().value!);
    cache.set(email, { expires: time + 5 * 60_000, value });
    return value;
  };
}
export const resolveGraphAvatar = createGraphAvatarLookup();
