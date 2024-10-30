import React from 'react';
import { Heart, Sprout, TreePine } from 'lucide-react';

export function About() {
  return (
    <section id="about" className="py-20 relative overflow-hidden">      
      <div className="container mx-auto px-6 relative">
        <div className="max-w-4xl mx-auto text-center">
          <div className="backdrop-blur-sm bg-white/10 rounded-2xl p-8 shadow-lg mb-16">
            <h2 className="text-4xl font-bold text-emerald-800">
              Meet Mei Mei
            </h2>
          </div>

          <div className="relative">
            <div className="mb-12">
              <div className="aspect-square max-w-md mx-auto rounded-2xl overflow-hidden shadow-lg">
                <video 
                  autoPlay 
                  loop 
                  muted 
                  playsInline
                  className="w-full h-full object-cover"
                >
                  <source src="https://media.giphy.com/media/nyqrQENF3vtkwiFkPO/giphy.mp4" type="video/mp4" />
                  Your browser does not support the video tag.
                </video>
              </div>
            </div>

            <div className="space-y-8">
              {[
                {
                  icon: Heart,
                  title: 'Digital Origins',
                  content: 'Born in the nexus of nature and technology, Mei Mei emerged as a bridge between ancient wisdom and future innovation.'
                },
                {
                  icon: Sprout,
                  title: 'Cyber Mission',
                  content: 'Harnessing blockchain technology to create a sustainable digital ecosystem where every transaction plants seeds of change.'
                },
                {
                  icon: TreePine,
                  title: 'Digital Forest Stats',
                  items: [
                    'Guardian of the Virtual Bamboo Grove',
                    'Quantum Farming Pioneer',
                    'Eco-Algorithm Specialist'
                  ]
                }
              ].map((section) => (
                <div 
                  key={section.title}
                  className="bg-white rounded-2xl p-8 shadow-lg hover:shadow-xl transition-shadow duration-300 text-center"
                >
                  <div className="flex items-center justify-center space-x-4 mb-4">
                    <section.icon className="w-8 h-8 text-emerald-600" />
                    <h3 className="text-2xl font-semibold text-emerald-800">
                      {section.title}
                    </h3>
                  </div>
                  
                  {section.content ? (
                    <p className="text-emerald-700 leading-relaxed">
                      {section.content}
                    </p>
                  ) : (
                    <ul className="space-y-4">
                      {section.items?.map((item, i) => (
                        <li key={i} className="flex items-center justify-center space-x-3 text-emerald-700">
                          <div className="w-2 h-2 bg-emerald-400 rounded-full" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}