/** Shared grammar for image alt text: `description|width|nocap|nozoom`. */
export function parseImageDirectives(value: string) {
  const [alt = '', ...modifiers] = value.split('|').map((part) => part.trim());
  let width: string | undefined;
  let noCaption = false;
  let noZoom = false;
  for (const modifier of modifiers) {
    if (/^\d+$/.test(modifier)) width = modifier;
    else if (/^(nocap|nocaption)$/i.test(modifier)) noCaption = true;
    else if (/^nozoom$/i.test(modifier)) noZoom = true;
  }
  return { alt, width, noCaption, noZoom };
}
