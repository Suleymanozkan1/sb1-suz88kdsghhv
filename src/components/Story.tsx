import React from 'react';
import { Newspaper } from 'lucide-react';

export function Story() {
  return (
    <section id="story" className="py-20 relative overflow-hidden">
      <div className="container mx-auto px-6 relative">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-2xl p-8 shadow-lg">
            <div className="backdrop-blur-sm bg-white/10 rounded-xl p-4 mb-8">
              <div className="flex items-center justify-center">
                <Newspaper className="w-8 h-8 text-emerald-600 mr-3" />
                <h2 className="text-4xl font-bold text-emerald-800">
                  Our Story
                </h2>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-8 items-center">
              <div className="w-full aspect-square relative rounded-xl overflow-hidden shadow-lg">
                <img
                  src="https://kids.guinnessworldrecords.com/Images/Hehe-Meimei-with-Cert-and-keeper_tcm55-584263.jpg"
                  alt="Twin Pandas with Guinness World Record"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="space-y-4">
                <h3 className="text-2xl font-semibold text-emerald-800">
                  Twin Pandas Make History in Conservation First
                </h3>
                <p className="text-emerald-700 leading-relaxed">
                  He He ("Harmony") and Mei Mei ("Beautiful") have made history as the first twin pandas born to a captive mother and wild father. This groundbreaking event marks a significant milestone in panda conservation efforts.
                </p>
                <a
                  href="https://kids.guinnessworldrecords.com/news/2019/7/twin-pandas-born-in-china-make-history-in-conservation-first-582453"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block px-6 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors"
                >
                  Read Full Story
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}