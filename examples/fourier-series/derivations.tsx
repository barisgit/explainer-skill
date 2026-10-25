/* The two derivations the coefficients stepper walks through, one line of maths and its caption per step. */
import type { ComponentChildren } from "preact";
import type { WaveName } from "./fourier.ts";
import { Alt, An, Bn, Dx, F, Frac, Int, Nx, Period } from "./math.tsx";

/** One step: the line of the derivation it adds, and what the caption says about it. */
export interface Step {
	eq: ComponentChildren;
	caption: ComponentChildren;
}

const nPi = (
	<>
		<i>n</i>π
	</>
);
const half = <Int from="0" to="π" />;

export const DERIVATIONS: Record<WaveName, Step[]> = {
	square: [
		{
			eq: (
				<>
					<An /> = <Frac top="1" bottom="π" /> <Period /> <F /> cos <Nx />
					<Dx /> = 0
				</>
			),
			caption: (
				<>
					Cosine coefficients first. The square wave is odd and cos <i>nx</i> is even, so the
					integrand is odd and its integral over a symmetric interval is zero. The same argument
					gives <i>a</i>
					<sub>0</sub> = 0.
				</>
			),
		},
		{
			eq: (
				<>
					<Bn /> = <Frac top="1" bottom="π" /> <Period /> <F /> sin <Nx />
					<Dx />
				</>
			),
			caption: (
				<>
					The sine coefficient uses the same recipe with sin <i>nx</i>. Here <i>f</i> = −1 on the
					left half of the period and +1 on the right half.
				</>
			),
		},
		{
			eq: (
				<>
					= <Frac top="2" bottom="π" /> {half} sin <Nx />
					<Dx />
				</>
			),
			caption: (
				<>
					<i>f</i> and sin <i>nx</i> are both odd, so their product is even: integrate over half the
					period and double. On (0, π) the square wave is 1.
				</>
			),
		},
		{
			eq: (
				<>
					= <Frac top="2" bottom="π" /> [ −
					<Frac
						top={
							<>
								cos <Nx />
							</>
						}
						bottom={<i>n</i>}
					/>{" "}
					]<sub>0</sub>
					<sup>π</sup> = <Frac top="2" bottom={nPi} /> (1 − cos <i>n</i>π)
				</>
			),
			caption: (
				<>
					Integrate sin <i>nx</i> and put in the limits. cos 0 = 1 supplies the 1.
				</>
			),
		},
		{
			eq: (
				<>
					= <Frac top="2" bottom={nPi} /> (1 − <Alt />) = <Frac top="4" bottom={nPi} /> for odd{" "}
					<i>n</i>, and 0 for even <i>n</i>
				</>
			),
			caption: (
				<>
					cos <i>n</i>π is −1 or +1 as <i>n</i> is odd or even. Even harmonics cancel; odd ones keep
					4/(<i>n</i>π).
				</>
			),
		},
		{
			eq: (
				<>
					<F /> = <Frac top="4" bottom="π" /> ( sin <i>x</i> + <Frac top="1" bottom="3" /> sin 3
					<i>x</i> + <Frac top="1" bottom="5" /> sin 5<i>x</i> + … )
				</>
			),
			caption: (
				<>
					Put the coefficients back into the series. This is the sum being built at the top of the
					page.
				</>
			),
		},
	],
	saw: [
		{
			eq: (
				<>
					<An /> = <Frac top="1" bottom="π" /> <Period /> <i>x</i> cos <Nx />
					<Dx /> = 0
				</>
			),
			caption: (
				<>
					Cosine coefficients first. <i>x</i> is odd and cos <i>nx</i> is even, so the integrand is
					odd and integrates to zero over (−π, π). So does <i>a</i>
					<sub>0</sub>.
				</>
			),
		},
		{
			eq: (
				<>
					<Bn /> = <Frac top="1" bottom="π" /> <Period /> <i>x</i> sin <Nx />
					<Dx />
				</>
			),
			caption: (
				<>
					The sine coefficient with <i>f</i>(<i>x</i>) = <i>x</i> on one period.
				</>
			),
		},
		{
			eq: (
				<>
					= <Frac top="2" bottom="π" /> {half} <i>x</i> sin <Nx />
					<Dx />
				</>
			),
			caption: (
				<>
					<i>x</i> and sin <i>nx</i> are both odd, so the product is even: integrate over (0, π) and
					double.
				</>
			),
		},
		{
			eq: (
				<>
					= <Frac top="2" bottom="π" /> [ −
					<Frac
						top={
							<>
								<i>x</i> cos <Nx />
							</>
						}
						bottom={<i>n</i>}
					/>{" "}
					+{" "}
					<Frac
						top={
							<>
								sin <Nx />
							</>
						}
						bottom={
							<>
								<i>n</i>
								<sup>2</sup>
							</>
						}
					/>{" "}
					]<sub>0</sub>
					<sup>π</sup> = <Frac top="2" bottom="π" /> · −
					<Frac
						top={
							<>
								π cos <i>n</i>π
							</>
						}
						bottom={<i>n</i>}
					/>
				</>
			),
			caption: (
				<>
					Integration by parts. At both limits sin <i>nx</i> is 0, and the <i>x</i> cos <i>nx</i>{" "}
					term is 0 at <i>x</i> = 0, so only −π cos <i>n</i>π/<i>n</i> remains.
				</>
			),
		},
		{
			eq: (
				<>
					= −
					<Frac
						top={
							<>
								2<Alt />
							</>
						}
						bottom={<i>n</i>}
					/>{" "}
					={" "}
					<Frac
						top={
							<>
								2(−1)
								<sup>
									<i>n</i>+1
								</sup>
							</>
						}
						bottom={<i>n</i>}
					/>
				</>
			),
			caption: (
				<>
					With cos <i>n</i>π = <Alt />: +2/<i>n</i> for odd <i>n</i> and −2/<i>n</i> for even{" "}
					<i>n</i>. Every harmonic is present, with alternating signs.
				</>
			),
		},
		{
			eq: (
				<>
					<F /> = 2 ( sin <i>x</i> − <Frac top="1" bottom="2" /> sin 2<i>x</i> +{" "}
					<Frac top="1" bottom="3" /> sin 3<i>x</i> − … )
				</>
			),
			caption: (
				<>
					Put the coefficients back into the series. This is the sawtooth being built at the top of
					the page.
				</>
			),
		},
	],
};
