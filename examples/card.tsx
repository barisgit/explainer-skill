/* The gallery's card for one example. Rendered once when the page packs. */
import type { ComponentChildren } from "preact";

interface CardProps {
	/** The example's directory under examples/, which also names its thumbnails in media/. */
	name: string;
	/** What the thumbnail shows; the same in either scheme. */
	alt: string;
	/** The card's heading and description. */
	children: ComponentChildren;
}

/** A link to `<name>/` with the example's thumbnail in both schemes (the kit's theme hides the other one) over its text. */
export function Card({ name, alt, children }: CardProps) {
	return (
		<a class="card" href={`${name}/`}>
			<img class="light" src={`media/${name}-thumb-light.webp`} alt={alt} />
			<img class="dark" src={`media/${name}-thumb-dark.webp`} alt={alt} />
			{children}
		</a>
	);
}
