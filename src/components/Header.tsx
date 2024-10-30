import React from 'react';
import { Menu, X } from 'lucide-react';

export function Header() {
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);

  const menuItems = [
    { href: '#home', label: 'Home', gradient: 'from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400' },
    { href: '#about', label: 'Meet Mei Mei', gradient: 'from-pink-500 to-purple-500 hover:from-pink-400 hover:to-purple-400' },
    { href: '#tokenomics', label: 'Tokenomics', gradient: 'from-blue-500 to-indigo-500 hover:from-blue-400 hover:to-indigo-400' },
    { href: '#join', label: 'Join Us', gradient: 'from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400' },
    { href: '#story', label: 'Our Story', gradient: 'from-pink-500 to-purple-500 hover:from-pink-400 hover:to-purple-400' }
  ];

  return (
    <header className="fixed w-full z-50">
      <nav className="container mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <img
              src="https://images.unsplash.com/photo-1566487097168-e91a4f38bee2?ixlib=rb-1.2.1&auto=format&fit=crop&w=300&q=80"
              alt="Panda Logo"
              className="w-12 h-12 rounded-full object-cover border-2 border-emerald-600"
            />
            <span className="text-2xl font-bold text-white">Mei Mei</span>
          </div>
          
          <div className="hidden md:flex items-center space-x-4">
            {menuItems.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className={`px-4 py-2 bg-gradient-to-r ${item.gradient} text-white rounded-full transition-all transform hover:scale-105`}
              >
                {item.label}
              </a>
            ))}
          </div>

          <button 
            className="md:hidden text-white"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            {isMenuOpen ? <X /> : <Menu />}
          </button>
        </div>

        {isMenuOpen && (
          <div className="md:hidden mt-4 p-4 bamboo-card rounded-lg space-y-2">
            {menuItems.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className={`block py-2 px-4 text-white rounded-full bg-gradient-to-r ${item.gradient} text-center`}
              >
                {item.label}
              </a>
            ))}
          </div>
        )}
      </nav>
    </header>
  );
}