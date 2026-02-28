import { NextResponse } from 'next/server';

// Simple debug endpoint to verify configuration
export async function GET() {
  const animalMap: Record<string, string> = {
    'animal-sparrow': 'sparrow',
    'animal-gecko': 'gecko',
    'animal-herring': 'herring',
    'animal-taipan': 'taipan',
    'animal-muskrat': 'muskrat',
    'animal-pudu': 'pudu',
    'animal-colobus': 'colobus',
    'animal-inkfish': 'inkfish',
  };

  const robotMap: Record<string, string> = {
    'robot-1': 'robot1',
    'robot-2': 'robot2',
    'robot-3': 'robot3',
    'robot-4': 'robot4',
  };

  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    animalMap,
    robotMap,
    totalModels: Object.keys(animalMap).length + Object.keys(robotMap).length,
  });
}
