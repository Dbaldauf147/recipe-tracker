/**
 * Fetches an Instagram post's caption using the Apify-backed
 * /api/instagram-caption serverless function.
 */

export async function fetchInstagramCaption(url) {
  const res = await fetch(`/api/instagram-caption?url=${encodeURIComponent(url)}`);

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      body.error || 'Could not fetch the Instagram caption. Try copying it manually instead.'
    );
  }

  const { caption } = await res.json();

  if (!caption) {
    throw new Error(
      'No caption found for this Instagram post. Try copying it manually instead.'
    );
  }

  return caption;
}
