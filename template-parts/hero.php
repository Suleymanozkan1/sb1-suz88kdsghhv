<?php
/**
 * Hero Section Template Part
 */
?>

<section id="home" class="min-h-screen pt-20 relative overflow-hidden">
    <div class="container mx-auto px-6 relative">
        <div class="flex flex-col items-center text-center pt-20">
            <div class="mb-8 floating">
                <?php get_template_part('template-parts/icons/sparkles'); ?>
            </div>
            
            <h1 class="text-5xl md:text-7xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400 mb-6 neon-text">
                <?php echo carbon_get_theme_option('hero_title'); ?>
            </h1>
            
            <p class="text-xl md:text-2xl text-emerald-300 max-w-2xl mb-12">
                <?php echo carbon_get_theme_option('hero_subtitle'); ?>
            </p>
            
            <div class="flex flex-col sm:flex-row gap-4">
                <a href="#about" 
                   class="px-8 py-4 bg-gradient-to-r from-emerald-500 to-cyan-500 text-white rounded-full hover:from-emerald-400 hover:to-cyan-400 transition-all transform hover:scale-105 neon-border">
                    Our Story
                </a>
                <a href="#tokenomics" 
                   class="px-8 py-4 bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-full hover:from-pink-400 hover:to-purple-400 transition-all transform hover:scale-105 neon-border">
                    Buy Token
                </a>
                <a href="#chart" 
                   class="px-8 py-4 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-full hover:from-blue-400 hover:to-indigo-400 transition-all transform hover:scale-105 neon-border">
                    Chart
                </a>
            </div>

            <div class="mt-20 grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl">
                <?php
                $stats = array(
                    array(
                        'icon' => 'leaf',
                        'title' => 'Eco-Friendly',
                        'value' => '100%'
                    ),
                    array(
                        'icon' => 'zap',
                        'title' => 'Energy Efficient',
                        'value' => '99.9%'
                    ),
                    array(
                        'icon' => 'sparkles',
                        'title' => 'Digital Forest',
                        'value' => '10,000+'
                    )
                );

                foreach ($stats as $stat): ?>
                    <div class="holographic p-6 rounded-2xl backdrop-blur-lg floating">
                        <?php get_template_part('template-parts/icons/' . $stat['icon']); ?>
                        <div class="text-3xl font-bold text-emerald-400 neon-text"><?php echo $stat['value']; ?></div>
                        <div class="text-emerald-300"><?php echo $stat['title']; ?></div>
                    </div>
                <?php endforeach; ?>
            </div>
        </div>
    </div>
</section>