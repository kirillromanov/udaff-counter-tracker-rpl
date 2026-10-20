import { describe, expect, it } from "vitest";
import { extractForumPost, parseForumTimestamp } from "@/lib/domain/forum/extract-comments";

const html = `<html><head><title>11й тур РПЛ &#171; Удаффком</title></head><body>
<div class="post-headline"><h1>Сяду на коня &#8212; 11й тур РПЛ</h1></div>
<ul class="commentlist">
<li class="comment" id="comment-4521">
<div class="clearfix comment-container<br />
<b>Warning</b>: Undefined variable $comment_id in <b>bfa_custom_comments.php</b> on line <b>9</b><br />
">
<div class="comment-author vcard"><span class="authorname">Hordi Cruyff</span></div>
<div class="comment-meta commentmetadata">
<a href="https://canadaru.net/udaff_afterlife/sport/football/rpl/2633/#comment-4521">16/10/2026 at 10:10</a>
</div>
<p>17.10.2026 14:00 Крылья Советов — Факел 2-0<br />
18.10.2026 16:15 Динамо — ЦСКА (МТ) 2-2</p>
</div>
<ul class="children">
<li class="comment" id="comment-4525">
<div class="comment-author vcard"><span class="authorname">Камидиант</span></div>
<div class="comment-meta commentmetadata">
<a href="https://canadaru.net/udaff_afterlife/sport/football/rpl/2633/#comment-4525">16/10/2026 at 10:33</a>
</div>
<p>это не прогноз, а ответ</p>
</div>
</li>
</ul>
</li>
</ul>
</body></html>`;

describe("extractForumPost", () => {
  it("reads the title, author, timestamp, and plain text from broken comment markup", () => {
    const post = extractForumPost(html, "https://canadaru.net/udaff_afterlife/sport/football/rpl/2633/");

    expect(post.title).toBe("Сяду на коня — 11й тур РПЛ");
    expect(post.comments).toHaveLength(2);
    expect(post.comments[0]).toMatchObject({
      externalId: "4521",
      authorName: "Hordi Cruyff",
    });
    expect(post.comments[0]?.postedAt?.toISOString()).toBe("2026-10-16T10:10:00.000Z");
    expect(post.comments[0]?.rawText).toContain("Крылья Советов — Факел 2-0");
    expect(post.comments[0]?.rawText).toContain("(МТ)");
    expect(post.comments[0]?.rawHtml).toContain("comment-container");
    expect(post.comments[1]).toMatchObject({
      externalId: "4525",
      authorName: "Камидиант",
      rawText: "это не прогноз, а ответ",
    });
  });

  it("parses the forum timestamp", () => {
    expect(parseForumTimestamp("16/10/2026 at 10:10")?.toISOString()).toBe("2026-10-16T10:10:00.000Z");
    expect(parseForumTimestamp("not a date")).toBeNull();
  });
});
