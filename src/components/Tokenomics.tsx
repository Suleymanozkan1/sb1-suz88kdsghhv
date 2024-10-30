import React from 'react';
import { Coins, Lock, Leaf } from 'lucide-react';

export function Tokenomics() {
  return (
    <section id="tokenomics" className="py-20 relative overflow-hidden">
      <div className="container mx-auto px-6 relative">
        <div className="backdrop-blur-sm bg-white/10 rounded-2xl p-8 shadow-lg mb-16">
          <h2 className="text-4xl font-bold text-white text-center">
            Digital Ecosystem
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            {
              icon: Coins,
              title: 'Total Supply',
              value: '420.69B',
              description: 'Fixed quantum supply'
            },
            {
              icon: Lock,
              title: 'Locked Pool',
              value: '95%',
              description: 'Time-locked liquidity'
            },
            {
              icon: Leaf,
              title: 'Eco Fund',
              value: '5%',
              description: 'Green initiatives'
            }
          ].map((item) => (
            <div 
              key={item.title}
              className="bg-white rounded-2xl p-8 shadow-lg hover:shadow-xl transition-shadow duration-300 text-center"
            >
              <item.icon className="w-12 h-12 text-emerald-600 mb-4 mx-auto" />
              <h3 className="text-xl font-semibold text-emerald-800 mb-2">
                {item.title}
              </h3>
              <div className="text-3xl font-bold text-emerald-600 mb-2">
                {item.value}
              </div>
              <p className="text-emerald-700">{item.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}