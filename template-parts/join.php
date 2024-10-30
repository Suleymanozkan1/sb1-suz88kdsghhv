<?php
/**
 * Join Section Template Part
 */
?>

<section id="join" class="py-20 relative overflow-hidden">
    <div class="container mx-auto px-6 relative">
        <div class="max-w-4xl mx-auto text-center">
            <h2 class="text-4xl font-bold text-emerald-800 mb-6">
                <?php echo carbon_get_theme_option('join_title'); ?>
            </h2>
            <p class="text-xl text-emerald-700 mb-12">
                <?php echo carbon_get_theme_option('join_subtitle'); ?>
            </p>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                <?php 
                $platforms = carbon_get_theme_option('social_platforms');
                if ($platforms):
                    foreach ($platforms as $platform): ?>
                        <a
                            href="<?php echo esc_url($platform['link']); ?>"
                            class="group bg-white/90 backdrop-blur-sm rounded-2xl p-8 shadow-lg transition-all transform hover:-translate-y-1"
                        >
                            <div class="w-16 h-16 <?php echo esc_attr($platform['color_class']); ?> rounded-full flex items-center justify-center mx-auto mb-4">
                                <?php get_template_part('template-parts/icons/' . $platform['icon']); ?>
                            </div>
                            <h3 class="text-xl font-semibold text-emerald-800">
                                <?php echo esc_html($platform['name']); ?>
                            </h3>
                        </a>
                    <?php endforeach;
                endif; ?>
            </div>
        </div>
    </div>
</section>