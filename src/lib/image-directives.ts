// The grammar of an image's alt text: `description|width|nozoom`.
export function parseImageDirectives(value: string) {
  const [alt = '', ...modifiers] = value.split('|').map((part) => part.trim());
  let width: string | undefined;
  let noZoom = false;
  for (const modifier of modifiers) {
    if (/^\d+$/.test(modifier)) width = modifier;
    else if (/^nozoom$/i.test(modifier)) noZoom = true;
  }
  return { alt, width, noZoom };
}
