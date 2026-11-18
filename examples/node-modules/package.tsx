"use client";
/* One installed package, as the filled package view shows it: why it is here, what needs it, what it needs, its other copies. */
import type { PackageRecord } from "./model.ts";

type Link = PackageRecord["requires"][number];

const linked = (p: Link) => <a href={`#package/${p.id}`}>{p.label}</a>;

function Related({ title, items }: { title: string; items: Link[] }) {
	if (items.length === 0) {
		return null;
	}
	return (
		<div>
			<p class="label">
				{title} {items.length}
			</p>
			<ul>
				{items.map((p) => (
					<li key={p.id}>
						{linked(p)}, {p.size}
					</li>
				))}
			</ul>
		</div>
	);
}

export function Package({ record }: { record: PackageRecord }) {
	const alias = record.name !== record.package;
	return (
		<>
			<h1>
				{record.name} {record.version}
			</h1>
			<p>
				{alias ? `${record.package} ${record.version} under another name; ` : ""}
				{record.size} in {record.files.toLocaleString("en")} files, {record.license}.
			</p>
			{record.deprecated && (
				<p class="caveat">
					<b>Deprecated</b>
					{record.deprecated}
				</p>
			)}
			<section>
				<h2>Why it is here</h2>
				{record.listed ? (
					<p>Listed in package.json.</p>
				) : (
					<p>
						{record.chain.map((p, i) => (
							<>
								{i > 0 && " → "}
								{i < record.chain.length - 1 ? linked(p) : p.label}
							</>
						))}
					</p>
				)}
				<div class="cols">
					<Related title="Required by" items={record.requiredBy} />
					<Related title="Requires" items={record.requires} />
					<Related title="Also on disk as" items={record.others} />
				</div>
			</section>
		</>
	);
}
