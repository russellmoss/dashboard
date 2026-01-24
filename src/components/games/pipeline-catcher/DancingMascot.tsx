import Image from 'next/image';

interface DancingMascotProps {
  size?: number;
  flipHorizontal?: boolean;
}

export default function DancingMascot({ size = 96, flipHorizontal = false }: DancingMascotProps) {
  return (
    <Image 
      src="/games/pipeline-catcher/images/mascot-dance.gif"
      alt="Dancing mascot"
      width={size}
      height={size}
      unoptimized
      style={{ 
        imageRendering: 'pixelated',
        transform: flipHorizontal ? 'scaleX(-1)' : 'none' 
      }}
    />
  );
}
