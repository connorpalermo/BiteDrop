import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DropHero } from '@/components/drop/DropHero';
import { RelatedDrops } from '@/components/drop/RelatedDrops';
import { RetailerRow } from '@/components/drop/RetailerRow';
import { SourceList } from '@/components/drop/SourceList';
import { repository } from '@/lib/repository';

interface DropPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: DropPageProps): Promise<Metadata> {
  const { slug } = await params;
  const drop = await repository.getBySlug(slug);
  if (!drop) return { title: 'Drop not found' };

  return {
    title: `${drop.name} — BiteDrop`,
    description: drop.shortDescription,
    openGraph: {
      title: drop.name,
      description: drop.shortDescription,
      images: drop.imageUrl ? [{ url: drop.imageUrl }] : undefined,
    },
  };
}

export default async function DropPage({ params }: DropPageProps) {
  const { slug } = await params;
  const drop = await repository.getBySlug(slug);
  if (!drop) notFound();

  return (
    <main id="main-content" className="mx-auto flex max-w-5xl flex-col gap-8 p-4 sm:p-6 lg:p-8">
      <DropHero drop={drop} />
      <RetailerRow retailers={drop.retailers} />
      <SourceList sources={drop.sources} />
      <RelatedDrops
        brandName={drop.brand?.name ?? null}
        categoryName={drop.category.name}
        relatedBySameBrand={drop.relatedBySameBrand}
        relatedBySameCategory={drop.relatedBySameCategory}
      />
    </main>
  );
}
