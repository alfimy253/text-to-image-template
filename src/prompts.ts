/*
 * Shared data: the Workers AI model id and the demo prompt
 * list. Used by the /image/:i route (worker side) and
 * interpolated into the client script by page.ts.
 */

export const MODEL = "@cf/stabilityai/stable-diffusion-xl-base-1.0";

export const prompts = [
	"Ghibli-inspired hand-painted anime scene of a young entrepreneur standing inside a tiny neighborhood shop before opening, warm morning sunlight entering through windows, shelves of products and simple checkout counter, gentle storytelling about what a business is, expressive character, hand-painted backgrounds, nostalgic cel animation texture, warm colors, a completely text-free image, no text, no words, no letters, no writing, no kanji, no Chinese characters, no Japanese characters, no subtitles, no signs, no logos, no watermarks, 16:9",

	"1990s nostalgic Studio Ghibli-inspired anime scene of a small business owner handing a product to a smiling customer across a wooden counter, another customer waiting behind, warm human interaction showing exchange and trust, detailed hand-painted shop interior, soft nostalgic lighting, expressive faces, a completely text-free image, no text, no words, no letters, no writing, no kanji, no Chinese characters, no Japanese characters, no subtitles, no signs, no logos, no watermarks, 16:9",
];
