/* Maths set in plain HTML: italic variables, stacked fractions, limits above and below a symbol (page.css draws them).
   The page, the derivations and the formula sheet build every formula from these. */
import type { ComponentChildren } from "preact";

type Part = ComponentChildren;

/** A stacked fraction. */
export const Frac = ({ top, bottom }: { top: Part; bottom: Part }) => (
	<span class="frac">
		<span>{top}</span>
		<span>{bottom}</span>
	</span>
);

/** A big symbol with its upper limit above and its lower limit below. */
const Lim = ({ sym, from, to }: { sym: string; from: Part; to: Part }) => (
	<span class="lim">
		<span>{to}</span>
		<span class="sym">{sym}</span>
		<span>{from}</span>
	</span>
);

export const Int = ({ from, to }: { from: Part; to: Part }) => <Lim sym="∫" from={from} to={to} />;
export const Sum = ({ from, to = "" }: { from: Part; to?: Part }) => (
	<Lim sym="Σ" from={from} to={to} />
);
/** The integral over one period, from −π to π. */
export const Period = () => <Int from="−π" to="π" />;
/** Σ from n = 1 to ∞. */
export const SumN = () => (
	<Sum
		from={
			<>
				<i>n</i> = 1
			</>
		}
		to="∞"
	/>
);

export const F = () => (
	<>
		<i>f</i>(<i>x</i>)
	</>
);
export const An = () => (
	<>
		<i>a</i>
		<sub>
			<i>n</i>
		</sub>
	</>
);
export const Bn = () => (
	<>
		<i>b</i>
		<sub>
			<i>n</i>
		</sub>
	</>
);
export const A0 = () => (
	<>
		<i>a</i>
		<sub>0</sub>
	</>
);
export const Nx = () => <i>nx</i>;
export const Dx = () => (
	<>
		{" "}
		d<i>x</i>
	</>
);
/** (−1) to the n. */
export const Alt = () => (
	<>
		(−1)
		<sup>
			<i>n</i>
		</sup>
	</>
);

/** The Fourier series of a signal with period 2π. */
export const Series = () => (
	<>
		<F /> = <Frac top={<A0 />} bottom="2" /> + <SumN /> (<An /> cos <Nx /> + <Bn /> sin <Nx />)
	</>
);
